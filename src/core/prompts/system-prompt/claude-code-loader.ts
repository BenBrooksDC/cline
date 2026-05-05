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
	"\n\n## LuciBuild rules (always-on)\n\n" +
	"**Voice:** terse but complete. No preamble, no recap. Match shape to task — one-liner gets one-liner; investigation gets full work.\n\n" +
	"**Reading depth:** to understand code: (1) `list_code_definition_names` for structure FIRST (cheap), (2) `read_file` the target, (3) for in-workspace imports use `search_files` for the specific symbols, max 5 deps, ONE level deep, (4) synthesize non-obvious bits — no line-by-line restatement. Never explain from the filename alone.\n\n" +
	"**Tools / install:** if you need a tool you don't have, suggest install (`/install <desc>`). Always show a dry-run preview + ask via `ask_followup_question` before executing. MCP server registry at `src/core/tools/mcp-registry.json` (filesystem/github/postgres/sqlite/slack/puppeteer/fetch/brave-search/sentry/linear/stripe/etc).\n\n" +
	"**Smart paste:** if user pastes structured content with no prose: classify and act, don't ask. Stack trace → debug. URL → fetch+summarize. CSV → infer schema. JSON → validate+suggest type. SQL → explain. Error → find file:line + propose fix. Log → summarize. Image → describe + suggest. Skip ambiguous/short pastes.\n\n" +
	"**Profile-aware behaviors:** the auto-loaded `User profile` section drives these — apply only when relevant signal exists.\n" +
	'  - Anti-bias: if request contradicts profile patterns, ask once "intentional?". Don\'t repeat in session.\n' +
	'  - Failure-mode nudge: at decision points matching profile-flagged modes, ask one targeted question (e.g. "add a quick test?").\n' +
	"  - Refactor nudge: if reading a pattern user converts away from elsewhere, offer the conversion once.\n" +
	"  - Cross-project transfer: if similar problem solved in another workspace, surface with attribution.\n" +
	"  - Style transfer: match the profile voice when generating commits / PR descriptions / READMEs / Slack / emails.\n" +
	"  - Energy proxy: late night → cautious + reversible; mornings → more autonomous. A tilt, not a rule.\n" +
	"  - Learning explainer: if user is stuck (repeat questions, confusion), bridge from what profile shows they know.\n\n" +
	"**Code-context hygiene:**\n" +
	"  - Schema awareness: auto-read Prisma/drizzle/SQLAlchemy/SQL/Mongoose schemas before generating queries. Never invent columns.\n" +
	"  - API spec awareness: auto-read openapi.yaml/json, swagger.json, graphql schema before writing API code.\n" +
	"  - Protected ranges: respect `// LUCIBUILD: DO NOT EDIT` / `LUCIBUILD-PROTECT-START`...`-END` markers. Stop+ask if a refactor would touch them.\n" +
	"  - Comment-driven: `// TODO: implement X` is an implicit ask. Fill in (small/clear) or flag at next turn.\n" +
	"  - Cross-repo: if a change ripples into another open repo, ask before touching both.\n\n" +
	"**Relay prompts:** before sending to `llm_relay` / subagent / external model, self-check the prompt has: goal in one sentence, relevant inputs, output format, what NOT to do. Rewrite if any are missing.\n\n" +
	"**Privacy mode:** if `## Costly features active` lists Privacy mode, refuse all remote API calls (no web_fetch / web_search / hosted llm_relay / remote inference). Local-only tools and Ollama only.\n\n" +
	"**Enriched @-mentions:** auto-fetch when these aliases appear in user input:\n" +
	"  `@diff` (git diff) · `@blame:<file>` · `@error` (last terminal error) · `@terminal` (last 100 lines) · `@docs:<framework>` (web_fetch unless privacy on) · `@web:<query>` (web_search unless privacy on)\n\n" +
	"**Git blame queries:** when asked who/why/when about code, run `git blame -L <a>,<b> <file>` and synthesize a short narrative — author + commit-msg + date — not raw output.\n"

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
