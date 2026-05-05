import { exec } from "child_process"
import * as fs from "fs/promises"
import * as path from "path"
import { promisify } from "util"
import { Logger } from "@/shared/services/Logger"

const execAsync = promisify(exec)
const COMMAND_TIMEOUT_MS = 3000

/**
 * LuciBuild fork: auto-attach a brief git context (recent commits + working-tree status)
 * to every session's system prompt when the workspace is a git repo. Lets the agent
 * answer "what did I change recently?" / "what's uncommitted?" without running new commands.
 *
 * Output is capped at ~3KB. Returns "" if not a git repo or if git is unavailable.
 */
export async function loadGitContext(workspacePath: string): Promise<string> {
	if (!workspacePath) {
		return ""
	}
	// Cheap check: is there a .git directory?
	try {
		await fs.access(path.join(workspacePath, ".git"))
	} catch {
		return ""
	}

	try {
		const cwd = workspacePath
		const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
		const opts = { cwd, env, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 64 }

		const [logRes, statusRes, branchRes] = await Promise.all([
			execAsync("git log --oneline -n 10", opts).catch(() => ({ stdout: "" })),
			execAsync("git status --short --branch", opts).catch(() => ({ stdout: "" })),
			execAsync("git branch --show-current", opts).catch(() => ({ stdout: "" })),
		])

		const log = (logRes.stdout || "").trim()
		const status = (statusRes.stdout || "").trim()
		const branch = (branchRes.stdout || "").trim()

		if (!log && !status) {
			return ""
		}

		const parts: string[] = []
		parts.push("\n\n## Git context (auto-attached by LuciBuild)")
		parts.push("")
		if (branch) {
			parts.push(`Current branch: \`${branch}\``)
		}
		if (status) {
			parts.push("")
			parts.push("Working tree (`git status --short`):")
			parts.push("```")
			parts.push(status.split("\n").slice(0, 30).join("\n"))
			parts.push("```")
		}
		if (log) {
			parts.push("")
			parts.push("Recent commits (last 10):")
			parts.push("```")
			parts.push(log)
			parts.push("```")
		}
		parts.push("")
		const result = parts.join("\n")
		// Cap at ~3KB
		if (result.length > 3000) {
			return result.slice(0, 3000) + "\n\n[... git context truncated ...]\n"
		}
		return result
	} catch (err) {
		Logger.warn(`GitContext: failed to load: ${(err as Error).message}`)
		return ""
	}
}
