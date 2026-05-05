import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

const ACCEPTANCE_LOG = path.join(os.homedir(), ".claude", "lucibuild-acceptance.jsonl")

/**
 * LuciBuild fork (T31): track every approval/rejection event from the user
 * for tool calls. The data feeds T22 (self-evaluation) and T33 (memory weight
 * promotion). Append-only JSONL at ~/.claude/lucibuild-acceptance.jsonl.
 */
export interface AcceptanceEvent {
	ts: string
	task_id: string
	tool_name: string
	accepted: boolean
	model?: string
	provider?: string
	preview?: string // short preview of the tool's intended action (≤200 chars)
}

const inMemoryStats: {
	totals: { accepted: number; rejected: number }
	perTool: Record<string, { accepted: number; rejected: number }>
} = {
	totals: { accepted: 0, rejected: 0 },
	perTool: {},
}
let loaded = false

function loadStatsFromDisk(): void {
	if (loaded) return
	loaded = true
	try {
		if (!fs.existsSync(ACCEPTANCE_LOG)) return
		const raw = fs.readFileSync(ACCEPTANCE_LOG, "utf-8")
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue
			try {
				const e = JSON.parse(line) as AcceptanceEvent
				const bucket = e.accepted ? "accepted" : "rejected"
				inMemoryStats.totals[bucket]++
				const t = (inMemoryStats.perTool[e.tool_name] = inMemoryStats.perTool[e.tool_name] || {
					accepted: 0,
					rejected: 0,
				})
				t[bucket]++
			} catch {
				/* skip malformed line */
			}
		}
	} catch (err) {
		Logger.warn(`AcceptanceTracker: failed to load: ${(err as Error).message}`)
	}
}

export function recordAcceptance(event: AcceptanceEvent): void {
	loadStatsFromDisk()
	try {
		fs.mkdirSync(path.dirname(ACCEPTANCE_LOG), { recursive: true })
		fs.appendFileSync(ACCEPTANCE_LOG, JSON.stringify(event) + "\n", "utf-8")
		const bucket = event.accepted ? "accepted" : "rejected"
		inMemoryStats.totals[bucket]++
		const t = (inMemoryStats.perTool[event.tool_name] = inMemoryStats.perTool[event.tool_name] || {
			accepted: 0,
			rejected: 0,
		})
		t[bucket]++
	} catch (err) {
		Logger.warn(`AcceptanceTracker: failed to record: ${(err as Error).message}`)
	}
}

/**
 * Returns a brief acceptance-stats summary suitable for injection into the
 * system prompt (T22 self-eval). "" if there's not enough data yet.
 */
export function getAcceptanceSummary(): string {
	loadStatsFromDisk()
	const total = inMemoryStats.totals.accepted + inMemoryStats.totals.rejected
	if (total < 5) {
		return "" // not enough signal yet
	}
	const overallRate = ((inMemoryStats.totals.accepted / total) * 100).toFixed(0)
	const lines = [
		"\n\n## Self-evaluation hint (LuciBuild T22)",
		"",
		`Your past tool-use acceptance rate: ${overallRate}% across ${total} actions.`,
		"Per-tool breakdown (only tools with ≥3 events):",
	]
	const perToolRows = Object.entries(inMemoryStats.perTool)
		.map(([tool, s]) => ({ tool, s, total: s.accepted + s.rejected }))
		.filter((r) => r.total >= 3)
		.sort((a, b) => a.s.accepted / a.total - b.s.accepted / b.total)
		.slice(0, 8)
	if (perToolRows.length === 0) {
		return ""
	}
	for (const r of perToolRows) {
		const pct = ((r.s.accepted / r.total) * 100).toFixed(0)
		lines.push(`- \`${r.tool}\`: ${pct}% accept (${r.s.accepted}/${r.total})`)
	}
	lines.push("")
	lines.push(
		"If a tool has a low accept rate, slow down on it: surface a clearer preview, ask for confirmation, or pick a different approach.",
	)
	lines.push("")
	return lines.join("\n")
}
