import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

const COSTLY_FEATURES_PATH = path.join(os.homedir(), ".claude", "lucibuild-costly-features.json")

/**
 * LuciBuild fork: registry of features that change cost surface area.
 *
 * Per the user's mandate (cost-toggle policy), any feature that:
 *   - introduces new outbound API spend, OR
 *   - doubles per-prompt cost, OR
 *   - starts background paid work
 * MUST default to OFF, have an explicit toggle, and surface a one-time
 * disclosure on first enable.
 *
 * Storage: ~/.claude/lucibuild-costly-features.json
 *   Schema: { [featureId]: { enabled: boolean, firstEnabledAt: string|null } }
 *
 * Each feature has a static spec (id, label, costEstimate, why) baked in here.
 */

export interface CostlyFeatureSpec {
	id: string
	label: string
	costEstimate: string
	why: string
}

export const COSTLY_FEATURES: CostlyFeatureSpec[] = [
	{
		id: "ab-testing",
		label: "A/B model testing",
		costEstimate: "Doubles your per-prompt API spend (~2x baseline).",
		why: "Sends every prompt to TWO models in parallel for side-by-side comparison; learns which model wins per task type.",
	},
	{
		id: "auto-doc-maintenance",
		label: "Auto-doc maintenance",
		costEstimate: "Adds ~$0.10–$0.50/day in background API calls (varies with codebase activity).",
		why: "Agent runs background LLM calls to keep DOCS.md fresh as your code changes.",
	},
	{
		id: "lora-fine-tuning",
		label: "Local LoRA fine-tuning (Ollama)",
		costEstimate: "No outbound API cost. Local compute: ~30 min/night on M-series Macs, ~10W average power.",
		why: "Nightly trains an adapter on your accept/reject pairs against an Ollama model; inference uses your adapter on top of the base model.",
	},
	{
		id: "privacy-mode",
		label: "Privacy mode (all-local-only)",
		costEstimate: "ZERO — disables remote API calls entirely. Many features become unavailable.",
		why: "Forces all model inference to local Ollama. Disables web_fetch, web_search, llm_relay (unless local-only), and any paid-API model.",
	},
	{
		id: "remote-completions",
		label: "Remote inline completions (T36b)",
		costEstimate: "~$0.50–$2/day for typical use (gpt-4o-mini for ghost-text per keystroke after debounce).",
		why: "Sends keystrokes (after a debounce) to a hosted model for Tab completions. Local Ollama model (T36a) is the free default.",
	},
	{
		id: "auto-github-mirror",
		label: "Auto GitHub mirror (Round T L4)",
		costEstimate:
			"No API cost. Uses bandwidth + your existing gh auth. Background pushes after each tarball backup (~once per 10 edits or 15 min).",
		why: "When a periodic tarball backup lands, push the workspace to a private GitHub mirror named lucibuild-mirror-<workspace> for cross-machine recoverability. Requires 'gh' CLI logged in.",
	},
]

interface FeatureState {
	enabled: boolean
	firstEnabledAt: string | null
}

let cache: Record<string, FeatureState> | null = null

async function load(): Promise<Record<string, FeatureState>> {
	if (cache) return cache
	try {
		const raw = await fs.readFile(COSTLY_FEATURES_PATH, "utf-8")
		cache = JSON.parse(raw) as Record<string, FeatureState>
	} catch {
		cache = {}
	}
	return cache
}

async function save(): Promise<void> {
	if (!cache) return
	try {
		await fs.mkdir(path.dirname(COSTLY_FEATURES_PATH), { recursive: true })
		await fs.writeFile(COSTLY_FEATURES_PATH, JSON.stringify(cache, null, 2) + "\n", "utf-8")
	} catch (err) {
		Logger.warn(`CostlyFeatures: failed to save: ${(err as Error).message}`)
	}
}

export async function isEnabled(featureId: string): Promise<boolean> {
	const state = await load()
	return state[featureId]?.enabled === true
}

export async function setEnabled(featureId: string, enabled: boolean): Promise<{ wasFirstEnable: boolean }> {
	const spec = COSTLY_FEATURES.find((f) => f.id === featureId)
	if (!spec) {
		throw new Error(`Unknown costly feature: ${featureId}`)
	}
	const state = await load()
	const prior = state[featureId] ?? { enabled: false, firstEnabledAt: null }
	const wasFirstEnable = enabled && prior.firstEnabledAt === null
	state[featureId] = {
		enabled,
		firstEnabledAt: prior.firstEnabledAt ?? (enabled ? new Date().toISOString() : null),
	}
	await save()
	return { wasFirstEnable }
}

export function getSpec(featureId: string): CostlyFeatureSpec | undefined {
	return COSTLY_FEATURES.find((f) => f.id === featureId)
}

/**
 * Returns a brief markdown summary of currently-enabled costly features for
 * injection into the system prompt. Returns "" if none enabled.
 */
export async function getEnabledFeaturesSummary(): Promise<string> {
	const state = await load()
	const enabled = COSTLY_FEATURES.filter((f) => state[f.id]?.enabled === true)
	if (enabled.length === 0) return ""
	const lines = ["\n\n## Costly features active (LuciBuild)", ""]
	for (const f of enabled) {
		lines.push(`- **${f.label}** — ${f.costEstimate}`)
	}
	lines.push("")
	return lines.join("\n")
}
