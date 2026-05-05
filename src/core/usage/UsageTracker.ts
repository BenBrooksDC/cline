import { exec } from "child_process"
import * as fs from "fs"
import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { calculateCost, inferProvider, type ProviderId } from "./pricing"

const USAGE_LOG_PATH = path.join(os.homedir(), ".claude", "lucibuild-usage.jsonl")
const BUDGETS_PATH = path.join(os.homedir(), ".claude", "budgets.json")
// Legacy path: silently migrate cline-cc-usage.jsonl on first launch so users don't lose history.
const LEGACY_USAGE_LOG_PATH = path.join(os.homedir(), ".claude", "cline-cc-usage.jsonl")

const DEFAULT_BUDGETS: BudgetsConfig = {
	providers: {
		openai: { daily_usd: 5.0, monthly_usd: 50.0 },
		anthropic: { daily_usd: 0, monthly_usd: 0, note: "use Max plan" },
		google: { daily_usd: 2.0, monthly_usd: 20.0 },
		xai: { daily_usd: 1.0, monthly_usd: 10.0 },
	},
	alerts: {
		soft_threshold: 0.75,
		hard_threshold: 1.0,
		drain_alert_minutes_remaining: 60,
		channels: ["vscode_notification", "macos_notification"],
	},
}

export interface BudgetsConfig {
	providers: Record<string, { daily_usd: number; monthly_usd: number; note?: string }>
	alerts: {
		soft_threshold: number
		hard_threshold: number
		drain_alert_minutes_remaining: number
		channels: string[]
	}
}

export interface UsageEvent {
	ts: string
	provider: ProviderId
	model: string
	input_tokens: number
	output_tokens: number
	cache_read_tokens: number
	cache_write_tokens: number
	cost_usd: number
	source: "cline" | "relay"
	task_id?: string
}

interface AccumulatedSpend {
	daily: number
	monthly: number
	calls: number
}

/**
 * LuciBuild fork: tracks every LLM API call (Cline-internal + LLM Relay) and
 * exposes live spend totals + budget enforcement. Logs to ~/.claude/cline-cc-usage.jsonl.
 */
export class UsageTracker {
	private static _instance: UsageTracker | undefined
	private dailySpend = new Map<ProviderId, AccumulatedSpend>()
	private monthlySpend = new Map<ProviderId, AccumulatedSpend>()
	private currentDay = ""
	private currentMonth = ""
	private budgets: BudgetsConfig = DEFAULT_BUDGETS
	private burnHistory: { ts: number; cost: number }[] = []
	private lastDrainAlertTs = 0

	private constructor() {
		this.refreshDateBuckets()
		this.migrateLegacyLog()
		this.loadBudgets().catch(() => {
			/* fall back to defaults */
		})
		this.loadTodayFromLog().catch(() => {
			/* empty start is fine */
		})
	}

	/**
	 * One-time migration: if the old ~/.claude/cline-cc-usage.jsonl exists and
	 * the new lucibuild-usage.jsonl does not, rename the old to the new.
	 * Runs synchronously on first instantiation; failures are silent.
	 */
	private migrateLegacyLog(): void {
		try {
			if (fs.existsSync(LEGACY_USAGE_LOG_PATH) && !fs.existsSync(USAGE_LOG_PATH)) {
				fs.renameSync(LEGACY_USAGE_LOG_PATH, USAGE_LOG_PATH)
			}
		} catch {
			/* ignore */
		}
	}

	static get(): UsageTracker {
		if (!UsageTracker._instance) {
			UsageTracker._instance = new UsageTracker()
		}
		return UsageTracker._instance
	}

	private refreshDateBuckets(): void {
		const now = new Date()
		const day = now.toISOString().slice(0, 10)
		const month = now.toISOString().slice(0, 7)
		if (day !== this.currentDay) {
			this.dailySpend.clear()
			this.currentDay = day
		}
		if (month !== this.currentMonth) {
			this.monthlySpend.clear()
			this.currentMonth = month
		}
	}

	private async loadBudgets(): Promise<void> {
		try {
			const raw = await fsp.readFile(BUDGETS_PATH, "utf-8")
			const parsed = JSON.parse(raw) as BudgetsConfig
			this.budgets = parsed
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code
			if (code === "ENOENT") {
				// Seed default file so the user can edit it
				try {
					await fsp.mkdir(path.dirname(BUDGETS_PATH), { recursive: true })
					await fsp.writeFile(BUDGETS_PATH, JSON.stringify(DEFAULT_BUDGETS, null, 2) + "\n", "utf-8")
				} catch {
					/* ignore */
				}
			}
		}
	}

	private async loadTodayFromLog(): Promise<void> {
		try {
			const raw = await fsp.readFile(USAGE_LOG_PATH, "utf-8")
			const today = new Date().toISOString().slice(0, 10)
			const month = today.slice(0, 7)
			for (const line of raw.split("\n")) {
				if (!line.trim()) {
					continue
				}
				try {
					const e = JSON.parse(line) as UsageEvent
					const eventDate = e.ts.slice(0, 10)
					const eventMonth = e.ts.slice(0, 7)
					if (eventDate === today) {
						this.bumpDaily(e.provider, e.cost_usd)
					}
					if (eventMonth === month) {
						this.bumpMonthly(e.provider, e.cost_usd)
					}
				} catch {
					/* skip malformed line */
				}
			}
		} catch {
			/* no log yet */
		}
	}

	private bumpDaily(provider: ProviderId, cost: number): void {
		const cur = this.dailySpend.get(provider) ?? { daily: 0, monthly: 0, calls: 0 }
		cur.daily += cost
		cur.calls += 1
		this.dailySpend.set(provider, cur)
	}

	private bumpMonthly(provider: ProviderId, cost: number): void {
		const cur = this.monthlySpend.get(provider) ?? { daily: 0, monthly: 0, calls: 0 }
		cur.monthly += cost
		this.monthlySpend.set(provider, cur)
	}

	/**
	 * Record an API call. Called from Cline's onUsageChunk handler in Task and from
	 * any wrappers around the LLM Relay.
	 */
	record(args: {
		modelId: string
		provider?: ProviderId
		inputTokens: number
		outputTokens: number
		cacheReadTokens?: number
		cacheWriteTokens?: number
		costUsd?: number // pre-computed cost (Cline already computes this); if omitted we calculate
		source?: "cline" | "relay"
		taskId?: string
	}): void {
		this.refreshDateBuckets()
		const provider = args.provider ?? inferProvider(args.modelId)
		const cost =
			args.costUsd ??
			calculateCost(
				args.modelId,
				provider,
				args.inputTokens,
				args.outputTokens,
				args.cacheReadTokens ?? 0,
				args.cacheWriteTokens ?? 0,
			)

		const event: UsageEvent = {
			ts: new Date().toISOString(),
			provider,
			model: args.modelId,
			input_tokens: args.inputTokens,
			output_tokens: args.outputTokens,
			cache_read_tokens: args.cacheReadTokens ?? 0,
			cache_write_tokens: args.cacheWriteTokens ?? 0,
			cost_usd: cost,
			source: args.source ?? "cline",
			task_id: args.taskId,
		}

		this.bumpDaily(provider, cost)
		this.bumpMonthly(provider, cost)
		this.burnHistory.push({ ts: Date.now(), cost })
		// Keep last 60 minutes of burn history
		const cutoff = Date.now() - 60 * 60 * 1000
		this.burnHistory = this.burnHistory.filter((b) => b.ts >= cutoff)

		// Append to JSONL (fire and forget)
		try {
			fs.mkdirSync(path.dirname(USAGE_LOG_PATH), { recursive: true })
			fs.appendFileSync(USAGE_LOG_PATH, JSON.stringify(event) + "\n", "utf-8")
		} catch (err) {
			Logger.warn(`UsageTracker: failed to write log: ${(err as Error).message}`)
		}

		// Drain-alert check
		this.maybeFireDrainAlert(provider)
	}

	getDailySpend(provider?: ProviderId): number {
		this.refreshDateBuckets()
		if (provider) {
			return this.dailySpend.get(provider)?.daily ?? 0
		}
		let total = 0
		for (const v of this.dailySpend.values()) {
			total += v.daily
		}
		return total
	}

	getMonthlySpend(provider?: ProviderId): number {
		this.refreshDateBuckets()
		if (provider) {
			return this.monthlySpend.get(provider)?.monthly ?? 0
		}
		let total = 0
		for (const v of this.monthlySpend.values()) {
			total += v.monthly
		}
		return total
	}

	getBurnRatePerMinute(): number {
		const cutoff = Date.now() - 60 * 60 * 1000
		const recent = this.burnHistory.filter((b) => b.ts >= cutoff)
		// Need at least 2 events spanning a meaningful window to avoid
		// extrapolating from a single recent call.
		if (recent.length < 2) {
			return 0
		}
		const totalCost = recent.reduce((sum, e) => sum + e.cost, 0)
		// Floor the window at 5 minutes — anything tighter blows up the rate.
		const elapsedMinutes = (Date.now() - recent[0].ts) / 60000
		const windowMinutes = Math.max(elapsedMinutes, 5)
		return totalCost / windowMinutes
	}

	getBudget(provider: ProviderId): { daily: number; monthly: number } {
		const b = this.budgets.providers[provider]
		return { daily: b?.daily_usd ?? 0, monthly: b?.monthly_usd ?? 0 }
	}

	getBudgetStatus(provider: ProviderId): {
		dailyPct: number
		monthlyPct: number
		dailyRemaining: number
		monthlyRemaining: number
		level: "ok" | "warning" | "over"
	} {
		const spent = this.getDailySpend(provider)
		const monthly = this.getMonthlySpend(provider)
		const budget = this.getBudget(provider)
		const dailyPct = budget.daily > 0 ? spent / budget.daily : 0
		const monthlyPct = budget.monthly > 0 ? monthly / budget.monthly : 0
		const worstPct = Math.max(dailyPct, monthlyPct)
		const level: "ok" | "warning" | "over" =
			worstPct >= this.budgets.alerts.hard_threshold
				? "over"
				: worstPct >= this.budgets.alerts.soft_threshold
					? "warning"
					: "ok"
		return {
			dailyPct,
			monthlyPct,
			dailyRemaining: Math.max(0, budget.daily - spent),
			monthlyRemaining: Math.max(0, budget.monthly - monthly),
			level,
		}
	}

	private maybeFireDrainAlert(provider: ProviderId): void {
		const burn = this.getBurnRatePerMinute()
		if (burn <= 0) {
			return
		}
		const status = this.getBudgetStatus(provider)
		if (status.dailyRemaining <= 0) {
			return
		}
		const minutesRemaining = status.dailyRemaining / burn
		if (minutesRemaining > this.budgets.alerts.drain_alert_minutes_remaining) {
			return
		}
		// Throttle to once per hour
		if (Date.now() - this.lastDrainAlertTs < 60 * 60 * 1000) {
			return
		}
		this.lastDrainAlertTs = Date.now()
		const msg = `LuciBuild: ${provider} daily budget will drain in ${minutesRemaining.toFixed(0)}min at current burn rate ($${burn.toFixed(4)}/min).`
		Logger.warn(msg)
		// macOS notification (best effort, no error if not on mac)
		try {
			const escaped = msg.replace(/"/g, "'")
			exec(`osascript -e 'display notification "${escaped}" with title "LuciBuild Drain Alert"'`)
		} catch {
			/* ignore */
		}
	}

	getSummary(): string {
		const total = this.getDailySpend()
		const providers: string[] = []
		for (const provider of ["openai", "google", "anthropic", "xai"] as ProviderId[]) {
			const spent = this.getDailySpend(provider)
			if (spent > 0) {
				const status = this.getBudgetStatus(provider)
				const budget = this.getBudget(provider).daily
				providers.push(
					`${provider}: $${spent.toFixed(2)}${budget > 0 ? `/$${budget.toFixed(0)} (${(status.dailyPct * 100).toFixed(0)}%)` : ""}`,
				)
			}
		}
		const burn = this.getBurnRatePerMinute()
		return `$${total.toFixed(2)} today | burn $${burn.toFixed(3)}/min | ${providers.join(" · ") || "no spend"}`
	}
}
