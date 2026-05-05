/**
 * Provider × model price table (USD per 1M tokens). Cline-CC fork addition.
 * Prices snapshotted 2026-01. Review quarterly.
 *
 * The fork's UsageTracker uses this to compute per-call cost and roll up daily/monthly
 * spend per provider. Cline already has accurate per-model pricing for the models it
 * supports natively (via ModelInfo.inputPrice / outputPrice); this table is a fallback
 * for providers/models where Cline doesn't pass a cost back, and for the LLM Relay
 * (which routes outside Cline's normal API path).
 */

export type ProviderId = "anthropic" | "openai" | "google" | "xai" | "unknown"

export interface ModelPrice {
	input: number // USD / 1M tokens
	output: number
	cacheRead?: number
	cacheWrite?: number
}

export const PRICE_TABLE: Record<string, ModelPrice> = {
	// Anthropic
	"claude-opus-4-7": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
	"claude-opus-4-6": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
	"claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
	"claude-sonnet-4-5": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
	"claude-haiku-4-5-20251001": { input: 0.8, output: 4.0, cacheRead: 0.08, cacheWrite: 1.0 },
	"claude-haiku-4-5": { input: 0.8, output: 4.0, cacheRead: 0.08, cacheWrite: 1.0 },

	// OpenAI
	"gpt-4o": { input: 2.5, output: 10.0 },
	"gpt-4o-mini": { input: 0.15, output: 0.6 },
	"gpt-5": { input: 2.5, output: 10.0 }, // placeholder
	"gpt-5-1": { input: 2.5, output: 10.0 }, // placeholder

	// Google
	"gemini-2.5-pro": { input: 1.25, output: 5.0 },
	"gemini-2.5-flash": { input: 0.3, output: 2.5 },
	"gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
	"gemini-3-pro": { input: 2.0, output: 10.0 },

	// xAI
	"grok-3": { input: 3.0, output: 15.0 },
	"grok-3-mini": { input: 0.3, output: 0.5 },
}

const FALLBACK_BY_PROVIDER: Record<ProviderId, ModelPrice> = {
	anthropic: { input: 15.0, output: 75.0 },
	openai: { input: 2.5, output: 10.0 },
	google: { input: 1.25, output: 5.0 },
	xai: { input: 3.0, output: 15.0 },
	unknown: { input: 5.0, output: 25.0 },
}

export function getPrice(modelId: string, provider: ProviderId = "unknown"): ModelPrice {
	const direct = PRICE_TABLE[modelId.toLowerCase()]
	if (direct) {
		return direct
	}
	// Fuzzy match: try without trailing date stamps
	const stripped = modelId.toLowerCase().replace(/-\d{8}$/, "")
	if (PRICE_TABLE[stripped]) {
		return PRICE_TABLE[stripped]
	}
	return FALLBACK_BY_PROVIDER[provider]
}

export function inferProvider(modelId: string): ProviderId {
	const m = modelId.toLowerCase()
	if (m.startsWith("claude")) {
		return "anthropic"
	}
	if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3")) {
		return "openai"
	}
	if (m.startsWith("gemini")) {
		return "google"
	}
	if (m.startsWith("grok")) {
		return "xai"
	}
	return "unknown"
}

export function calculateCost(
	modelId: string,
	provider: ProviderId,
	inputTokens: number,
	outputTokens: number,
	cacheReadTokens = 0,
	cacheWriteTokens = 0,
): number {
	const p = getPrice(modelId, provider)
	const inCost = (p.input * inputTokens) / 1_000_000
	const outCost = (p.output * outputTokens) / 1_000_000
	const cacheReadCost = ((p.cacheRead ?? p.input * 0.1) * cacheReadTokens) / 1_000_000
	const cacheWriteCost = ((p.cacheWrite ?? p.input * 1.25) * cacheWriteTokens) / 1_000_000
	return inCost + outCost + cacheReadCost + cacheWriteCost
}
