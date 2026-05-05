import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

const BANDIT_PATH = path.join(os.homedir(), ".claude", "lucibuild-prompt-bandit.json")
const EPSILON = 0.15 // 15% exploration rate

/**
 * LuciBuild fork (T32): epsilon-greedy bandit over prompt-template variants.
 *
 * For each task type, we maintain N prompt variants and stats on how often
 * each one led to a successful outcome (no rework / no rejection / no retry).
 *
 * On each call:
 *  - With probability EPSILON: pick a random variant (explore).
 *  - Otherwise: pick the variant with the highest accept rate (exploit).
 *
 * Storage: ~/.claude/lucibuild-prompt-bandit.json
 *   Schema: { [taskType]: { [variantId]: { trials: N, successes: N } } }
 *
 * Reward signal: feed via reportOutcome(taskType, variantId, success: boolean).
 * For now, the LLMRelayToolHandler can call reportOutcome based on whether
 * the relay output was used (no manual rework) — a heuristic, refinable later.
 */

interface VariantStats {
	trials: number
	successes: number
}

let cache: Record<string, Record<string, VariantStats>> | null = null
let dirty = false
let flushTimer: NodeJS.Timeout | null = null

async function load(): Promise<Record<string, Record<string, VariantStats>>> {
	if (cache) return cache
	try {
		const raw = await fs.readFile(BANDIT_PATH, "utf-8")
		cache = JSON.parse(raw) as Record<string, Record<string, VariantStats>>
	} catch {
		cache = {}
	}
	return cache
}

async function flush(): Promise<void> {
	if (!dirty || !cache) return
	dirty = false
	try {
		await fs.mkdir(path.dirname(BANDIT_PATH), { recursive: true })
		await fs.writeFile(BANDIT_PATH, JSON.stringify(cache, null, 2) + "\n", "utf-8")
	} catch (err) {
		Logger.warn(`PromptBandit: failed to flush: ${(err as Error).message}`)
	}
}

function scheduleFlush(): void {
	if (flushTimer) return
	flushTimer = setTimeout(() => {
		flushTimer = null
		flush().catch(() => {
			/* ignore */
		})
	}, 1500)
}

/**
 * Pick the next variant for a given taskType among the supplied IDs.
 * Returns the chosen variant ID. If the bandit has no data, returns the first ID.
 */
export async function pickVariant(taskType: string, variantIds: string[]): Promise<string> {
	if (variantIds.length === 0) {
		throw new Error("PromptBandit.pickVariant requires at least one variant")
	}
	if (variantIds.length === 1) return variantIds[0]
	const all = await load()
	const stats = all[taskType] ?? {}
	// Exploration
	if (Math.random() < EPSILON) {
		return variantIds[Math.floor(Math.random() * variantIds.length)]
	}
	// Exploitation: pick highest accept rate (Laplace smoothing for cold-start)
	let best = variantIds[0]
	let bestScore = -1
	for (const id of variantIds) {
		const s = stats[id] ?? { trials: 0, successes: 0 }
		const score = (s.successes + 1) / (s.trials + 2) // Laplace
		if (score > bestScore) {
			bestScore = score
			best = id
		}
	}
	return best
}

export async function reportOutcome(taskType: string, variantId: string, success: boolean): Promise<void> {
	const all = await load()
	if (!all[taskType]) all[taskType] = {}
	const s = (all[taskType][variantId] = all[taskType][variantId] ?? { trials: 0, successes: 0 })
	s.trials += 1
	if (success) s.successes += 1
	dirty = true
	scheduleFlush()
}

export async function getStats(taskType: string): Promise<Record<string, VariantStats>> {
	const all = await load()
	return all[taskType] ?? {}
}
