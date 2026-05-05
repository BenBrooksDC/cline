import { exec } from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { promisify } from "util"
import { Logger } from "@/shared/services/Logger"

const execAsync = promisify(exec)
const PROFILE_DIR = path.join(os.homedir(), ".claude", "lucibuild-profile")
const PROFILE_PATH = path.join(PROFILE_DIR, "profile.md")
const MAX_BYTES = 8000
const COMMAND_TIMEOUT_MS = 3000

/**
 * LuciBuild fork: persistent user profile (T20a + T21 + T25).
 *
 * Auto-loads at session start. Captures:
 *  - User's goals (manual entry; agent reads but doesn't unilaterally edit)
 *  - Coding style fingerprint auto-derived from recent commits in the current workspace
 *  - Frameworks in use, naming conventions, voice samples
 *  - Failure modes and strengths the user has acknowledged
 *
 * The profile lives ONLY at ~/.claude/lucibuild-profile/profile.md. Never sent to
 * third parties beyond as part of the LLM provider request the user already made.
 *
 * Edit the file directly to refine. The agent updates it via /remember or /profile.
 */

const DEFAULT_TEMPLATE = `# LuciBuild User Profile

## Goals
<!-- Pin your current high-priority goals here. The agent biases recommendations toward these. -->
- (no goals set yet — edit this file or ask the agent to set one)

## Coding style preferences
<!-- These are derived from your recent git commits when possible; you can override here. -->
- Indentation: (auto-detect from workspace)
- Line length: (auto-detect)
- Quote style: (auto-detect)
- Naming: (auto-detect)
- Test framework: (auto-detect)

## Voice (writing style)
<!-- Samples of your writing voice extracted from commits/docs. Used for style transfer. -->
- (none yet)

## Frameworks in use
- (auto-derived from package.json / requirements.txt across recent workspaces)

## Failure modes I've acknowledged
<!-- Patterns you've explicitly flagged. Agent surfaces them at decision points. -->
- (none yet)

## Strengths I've acknowledged
- (none yet)

## Cross-project learnings (with attribution)
<!-- Patterns the agent picked up in one workspace that may apply elsewhere. -->
- (none yet)
`

async function ensureProfileFile(): Promise<void> {
	try {
		await fs.access(PROFILE_PATH)
	} catch {
		await fs.mkdir(PROFILE_DIR, { recursive: true })
		await fs.writeFile(PROFILE_PATH, DEFAULT_TEMPLATE, "utf-8")
	}
}

/**
 * Derive a brief skill signature from the current workspace's recent commits.
 * Returns "" if not a git repo or git unavailable. Cached implicitly per call;
 * caller is responsible for caching across calls if needed.
 */
async function deriveSkillSignature(workspacePath: string): Promise<string> {
	if (!workspacePath) return ""
	try {
		await fs.access(path.join(workspacePath, ".git"))
	} catch {
		return ""
	}
	try {
		const opts = {
			cwd: workspacePath,
			env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
			timeout: COMMAND_TIMEOUT_MS,
			maxBuffer: 1024 * 64,
		}
		// Last 50 commit messages from this user (or all if user not configured)
		const userRes = await execAsync("git config user.email", opts).catch(() => ({ stdout: "" }))
		const email = (userRes.stdout || "").trim()
		const logCmd = email ? `git log --author="${email}" --pretty=format:"%s" -n 50` : 'git log --pretty=format:"%s" -n 50'
		const logRes = await execAsync(logCmd, opts).catch(() => ({ stdout: "" }))
		const messages = (logRes.stdout || "").trim()
		if (!messages) return ""

		const lines = messages.split("\n").slice(0, 50)
		const conventionalCount = lines.filter((l) =>
			/^(feat|fix|chore|docs|refactor|test|style|perf|ci|build)(\(.+\))?:/.test(l),
		).length
		const usesConventional = conventionalCount > lines.length * 0.5
		const avgLen = Math.round(lines.reduce((s, l) => s + l.length, 0) / Math.max(1, lines.length))
		const startsLowerCount = lines.filter((l) => /^[a-z]/.test(l)).length
		const usesLowerCase = startsLowerCount > lines.length * 0.5

		const segments = [
			`Recent commit-message style:`,
			`- Convention: ${usesConventional ? "Conventional Commits (feat:/fix:/etc.)" : "freeform"}`,
			`- Average length: ${avgLen} chars`,
			`- Casing: ${usesLowerCase ? "lowercase-leading" : "capitalized-leading"}`,
			"",
			"Recent commit-message samples (use these for voice fingerprinting):",
			...lines.slice(0, 5).map((l) => `  - "${l.slice(0, 100)}"`),
		]
		return segments.join("\n")
	} catch {
		return ""
	}
}

/**
 * Load the user profile + auto-derived skill signature for injection into the system prompt.
 * Returns "" if the profile is empty/missing AND no signature can be derived.
 */
export async function loadUserProfile(workspacePath: string): Promise<string> {
	try {
		await ensureProfileFile()
		let profile = ""
		try {
			profile = (await fs.readFile(PROFILE_PATH, "utf-8")).trim()
		} catch {
			profile = ""
		}
		const signature = await deriveSkillSignature(workspacePath)

		if (!profile && !signature) return ""

		const parts: string[] = ["", "", "## User profile (auto-loaded by LuciBuild)"]
		parts.push("")
		parts.push("Treat this as durable context about the user. Use it to bias responses, match")
		parts.push("their style, and pin their goals. Edit at " + PROFILE_PATH + " or ask the agent.")
		if (profile) {
			parts.push("")
			parts.push(profile)
		}
		if (signature) {
			parts.push("")
			parts.push("### Auto-derived skill signature (current workspace)")
			parts.push("")
			parts.push(signature)
		}
		parts.push("")

		const result = parts.join("\n")
		if (Buffer.byteLength(result, "utf-8") > MAX_BYTES) {
			return result.slice(0, MAX_BYTES) + "\n\n[... profile truncated ...]\n"
		}
		return result
	} catch (err) {
		Logger.warn(`UserProfile: failed to load: ${(err as Error).message}`)
		return ""
	}
}
