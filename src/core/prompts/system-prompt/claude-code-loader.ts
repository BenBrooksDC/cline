import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

const CLAUDE_MD_FILENAME = "CLAUDE.md"
const MAX_BYTES = 32000
const TRUNCATION_MESSAGE = "\n\n[... user CLAUDE.md context truncated at 32000 bytes ...]"
const HEADER = "\n\n## User CLAUDE.md (auto-loaded by Cline-CC)\n\n"
const FOOTER = "\n"

const VOICE_DIRECTIVE =
	"\n\n## LuciBuild voice & capabilities (always-on)\n\n" +
	'Respond tersely. No preamble like "I\'ll help you with that" — just do the work. ' +
	"No end-of-turn recap or summary unless the user asks. " +
	"Keep replies to 1-3 sentences when not generating code or running tools. " +
	"Only narrate at key moments: starting work, hitting a blocker, finishing. " +
	"Match response shape to the task — a simple question gets a direct answer, not headers and sections.\n\n" +
	"**Tool acquisition:** if the user's request would benefit from a tool you don't have, you can install one. " +
	"Use the `/install <description>` slash command, OR proactively suggest an install when you hit a capability wall. " +
	"Before installing anything, ALWAYS surface a dry-run preview (package, command, what it adds) and get explicit approval via ask_followup_question. " +
	"For MCP servers, consult the curated registry at `src/core/tools/mcp-registry.json` (in this fork's repo) — " +
	"it lists 15+ vetted servers (filesystem, github, postgres, sqlite, slack, puppeteer, brave-search, fetch, sequential-thinking, memory, linear, sentry, browser-tools, stripe) with install commands and capabilities.\n\n" +
	"**Smart paste:** if the user's message looks like a paste of structured content (no surrounding prose), classify it and act WITHOUT asking for clarification:\n" +
	"  - Stack trace (matches `Traceback (most recent call last):`, `at <fn>(<file>:<line>)`, `Error:`, etc.) → debug it, pinpoint the file/line, propose a fix.\n" +
	"  - URL alone → fetch the page (web_fetch) and summarize.\n" +
	"  - CSV / TSV (header row + comma/tab data) → infer schema, ask if they want a parser/import script.\n" +
	"  - JSON blob → format, validate, suggest a TypeScript/Python type for it.\n" +
	"  - SQL query → explain, suggest indexes, or run if the user has a DB MCP server installed.\n" +
	"  - Compile/lint error → identify the offending file:line, propose a fix.\n" +
	"  - Long log output (>30 lines, no narrative) → summarize key events and errors.\n" +
	"  - Image (image content block) → describe + suggest follow-up actions (OCR, generate UI, etc.).\n" +
	"Don't classify ambiguous or short pastes; treat those as plain text. Be fast and direct on classified pastes — the user pasted instead of typing because they want action, not a conversation.\n\n" +
	'**Anti-bias contradiction check (T26):** if the user asks for something that contradicts patterns in their profile ("User profile" section above) or recent commits, surface the contradiction once before proceeding. Phrasing: "You usually do X here — is the new approach intentional?" Don\'t lecture. Don\'t repeat. Once the user says "yes intentional," don\'t bring it up again in this session.\n\n' +
	'**Failure-mode detector (T27):** the user\'s profile may list acknowledged failure modes (e.g., "ships without tests when stressed", "over-engineers new languages"). At decision points relevant to those modes, surface a single nudge — not a lecture. Example: profile says "skips tests when stressed"; before "attempt_completion" on a non-trivial change, ask "Should I write a quick test for this before marking done?"\n\n' +
	"**Style transfer (T29):** when generating non-code text artifacts on the user's behalf (commit messages, PR descriptions, READMEs, Slack drafts, email replies), match the user's voice fingerprint from the profile. Mimic length, casing, structure, vocabulary. Don't invent your own style.\n\n" +
	"**Prompt self-evaluation (T35):** before you send a request to a subagent, the LLM Relay (`llm_relay`), or any external model, do a 3-second self-check on your prompt: (1) does it state the goal in one sentence? (2) does it include the relevant inputs (file paths, current code, error message)? (3) does it specify the output format you want? (4) does it say what NOT to do, if there's a known failure mode? If any answer is no, rewrite the prompt before sending — bad prompts waste tokens and produce broken output. This applies especially when delegating to gpt4o/gemini-pro via the relay, where rework is expensive.\n\n" +
	"**Personalized refactoring nudges (T23):** when you read code that follows a pattern the user has already converted away from (per their profile / commit history / cross-project learnings), proactively offer the conversion before they ask. Examples: callbacks → async/await, var → const/let, JS → TS, class components → hooks, sync I/O → async, untested helpers → tested. Don't auto-apply — ask once: \"You usually convert X to Y; should I refactor this one too?\" One question, then move on. Skip the nudge if there's no clear precedent in the user's profile.\n\n" +
	"**Cross-project pattern transfer (T28):** when you recognize that a problem the user faces here was already solved in another of their projects (per memory entries or session summaries from other workspaces), surface the connection explicitly: \"You solved a similar problem in <project> last <when> — should I apply the same approach?\" Always attribute the source so the user can disable the transfer if it's misleading. Don't transfer silently.\n\n" +
	"**Personalized learning explainer (T30):** when the user is clearly struggling with a concept (asks the same question twice, expresses confusion, repeats a wrong solution), do NOT just answer the immediate question. Instead, briefly diagnose the gap based on what their profile says they already know, and produce a focused 5-minute explainer that bridges from familiar to unfamiliar. Include a tiny working example. Skip generic tutorials — tailor to this user's existing knowledge.\n"

/**
 * Loads and processes the user's `~/CLAUDE.md` file for automatic context injection.
 * This is a feature specific to the Cline-CC (Claude Code) fork of the Cline extension.
 *
 * The function performs the following steps:
 * 1. Reads `~/CLAUDE.md`. If it doesn't exist, returns an empty string.
 * 2. Processes lines starting with `@<path>` (e.g., `@src/main.ts`).
 *    - It resolves the path relative to the user's home directory.
 *    - If the referenced file exists, its content is inlined.
 *    - If the file doesn't exist, or the path is invalid (e.g., `../...`), the line is left as is.
 * 3. Truncates the final content to a maximum of 32,000 bytes to avoid oversized prompts.
 * 4. Wraps the content in a standard header/footer for clear identification in the system prompt.
 * 5. Catches and logs any unexpected errors, returning an empty string to ensure extension stability.
 *
 * @returns {Promise<string>} The processed and formatted context from `~/CLAUDE.md`, or an empty string.
 */
export async function loadClaudeCodeContext(): Promise<string> {
	try {
		const homeDir = os.homedir()
		const claudeMdPath = path.join(homeDir, CLAUDE_MD_FILENAME)

		let rawContent: string
		try {
			rawContent = await fs.readFile(claudeMdPath, "utf-8")
		} catch (error: any) {
			if (error.code === "ENOENT") {
				return "" // File not found is a normal, silent case.
			}
			// Re-throw other initial read errors to be caught by the outer block.
			throw error
		}

		if (!rawContent.trim()) {
			return "" // File is empty or contains only whitespace.
		}

		const lines = rawContent.split("\n")
		const referenceRegex = /^\s*(?:[-*]\s+)?@(.+)$/

		const processedLines = await Promise.all(
			lines.map(async (line) => {
				const match = line.match(referenceRegex)
				if (!match) {
					return line // Not a reference line.
				}

				const relativePath = match[1].trim()

				// Security/Sanity check: Skip resolution for paths that try to escape the home directory.
				if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
					return line // Leave the line untouched.
				}

				const targetPath = path.join(homeDir, relativePath)

				try {
					const fileContent = await fs.readFile(targetPath, "utf-8")
					return fileContent // Replace the @-line with the file's content.
				} catch (error: any) {
					// If the referenced file doesn't exist or can't be read, leave the original line.
					// This is not a critical error, so we don't log it.
					return line
				}
			}),
		)

		let resolvedContent = processedLines.join("\n")

		// Check byte length and truncate if it exceeds the limit.
		if (Buffer.byteLength(resolvedContent, "utf-8") > MAX_BYTES) {
			const buffer = Buffer.from(resolvedContent, "utf-8")
			const truncatedBuffer = buffer.slice(0, MAX_BYTES)
			resolvedContent = truncatedBuffer.toString("utf-8") + TRUNCATION_MESSAGE
		}

		// Wrap the final content in the specified header and footer; also append the
		// always-on voice directive so non-Anthropic models (GPT-4o, Gemini) match the
		// terse Claude Code response shape.
		return `${HEADER}${resolvedContent}${FOOTER}${VOICE_DIRECTIVE}`
	} catch (error: any) {
		// Catch-all for unexpected errors (e.g., EACCES on CLAUDE.md).
		Logger.warn(`Cline-CC: Failed to load or process ~/CLAUDE.md. Error: ${error.message}`)
		// Even when CLAUDE.md is missing/unreadable, still return the voice directive
		// so Cline-CC's terse defaults apply on every chat.
		return VOICE_DIRECTIVE
	}
}
