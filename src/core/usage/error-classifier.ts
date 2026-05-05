/**
 * LuciBuild fork: API error classifier.
 *
 * Looks at error messages from the various provider APIs and surfaces a
 * specific suggested fallback model + human-readable hint. The classifier is
 * deliberately narrow — only matches known recurring error patterns so we
 * never mislead the user. Unknown errors return null and are surfaced as-is.
 */

export interface ErrorClassification {
	errorClass: string
	suggestedModel: string | null
	hint: string
}

interface Pattern {
	test: (msg: string, modelId: string) => boolean
	classification: (modelId: string) => ErrorClassification
}

const PATTERNS: Pattern[] = [
	{
		// OpenAI Responses-API codex error: missing reasoning item
		test: (msg, _modelId) => /required 'reasoning' item|reasoning_item/i.test(msg),
		classification: (modelId) => ({
			errorClass: "openai_responses_api_reasoning_item_missing",
			suggestedModel: "gpt-4.1",
			hint: `${modelId} uses OpenAI's Responses API which requires reasoning-item plumbing this fork doesn't fully wire up. Switch to gpt-4.1 (Chat Completions API) — it works cleanly. Click the model name at the bottom of the chat to switch.`,
		}),
	},
	{
		// Generic Responses-API mismatch
		test: (msg, _modelId) => /native tool calls|enableNativeToolCalls/i.test(msg),
		classification: (modelId) => ({
			errorClass: "native_tool_call_mismatch",
			suggestedModel: "gpt-4.1",
			hint: `${modelId} expects native tool calls but the fork's plumbing didn't enable them. Switch to gpt-4.1 or gemini-2.5-pro to avoid this.`,
		}),
	},
	{
		// Context window exceeded — let Cline's built-in handler do its thing, but flag it
		test: (msg, _modelId) => /context.{0,5}length|maximum context|tokens? in your prompt/i.test(msg),
		classification: (_modelId) => ({
			errorClass: "context_window_exceeded",
			suggestedModel: null,
			hint: "Context exceeded. Run /compact to condense the conversation, then retry.",
		}),
	},
	{
		// 401 / auth errors
		test: (msg, _modelId) => /401|unauthorized|invalid.{0,5}api.{0,5}key/i.test(msg),
		classification: (_modelId) => ({
			errorClass: "auth_failed",
			suggestedModel: null,
			hint: "API key is invalid or expired. Check the provider's dashboard and update the key in the LuciBuild settings.",
		}),
	},
	{
		// 429 rate-limit / quota
		test: (msg, _modelId) => /\b429\b|rate limit|quota.{0,5}exceeded/i.test(msg),
		classification: (_modelId) => ({
			errorClass: "rate_limited",
			suggestedModel: "gemini-2.5-pro",
			hint: "Provider rate-limited or quota exceeded. Try a different provider for the next few minutes (Gemini and Grok are usually clear).",
		}),
	},
]

/**
 * Classify an API error message. Returns null if no known pattern matches.
 */
export function classifyApiError(message: string, modelId: string): ErrorClassification | null {
	if (!message) {
		return null
	}
	for (const p of PATTERNS) {
		if (p.test(message, modelId)) {
			return p.classification(modelId)
		}
	}
	return null
}

/**
 * Build a human-readable hint string suitable for appending to streamingFailedMessage.
 * Returns "" if the error isn't classifiable.
 */
export function buildErrorHintSuffix(message: string, modelId: string): string {
	const c = classifyApiError(message, modelId)
	if (!c) {
		return ""
	}
	const modelLine = c.suggestedModel ? `\n→ Suggested fallback: \`${c.suggestedModel}\`` : ""
	return `\n\n[LuciBuild hint: ${c.errorClass}]\n${c.hint}${modelLine}`
}
