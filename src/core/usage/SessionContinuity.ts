import * as crypto from "crypto"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

const SESSIONS_DIR = path.join(os.homedir(), ".claude", "lucibuild-sessions")
const LAST_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * LuciBuild fork: persistent session-continuity state per workspace.
 *
 * On task completion, write a one-paragraph summary tagged to the workspace.
 * On the next session, auto-inject the most recent summary so the user can
 * say "continue what we were doing yesterday" without re-explaining.
 *
 * Storage: ~/.claude/lucibuild-sessions/<workspace-hash>/<timestamp>.md
 */

function workspaceHash(workspacePath: string): string {
	return crypto.createHash("sha256").update(workspacePath).digest("hex").slice(0, 12)
}

/**
 * Write a session summary on task completion. Markdown body should be ≤500 words.
 * Called from AttemptCompletionHandler.
 */
export async function writeSessionSummary(workspacePath: string, taskId: string, summary: string): Promise<void> {
	if (!workspacePath || !summary || !summary.trim()) {
		return
	}
	try {
		const dir = path.join(SESSIONS_DIR, workspaceHash(workspacePath))
		await fs.mkdir(dir, { recursive: true })
		const ts = new Date().toISOString().replace(/[:.]/g, "-")
		const file = path.join(dir, `${ts}.md`)
		const header = `---\nworkspace: ${workspacePath}\ntask_id: ${taskId}\nfinished_at: ${new Date().toISOString()}\n---\n\n`
		await fs.writeFile(file, header + summary.trim() + "\n", "utf-8")
	} catch (err) {
		Logger.warn(`SessionContinuity: failed to write summary: ${(err as Error).message}`)
	}
}

/**
 * Read the most recent session summary for this workspace (within the last 7 days).
 * Returns "" if none.
 */
export async function loadLastSessionSummary(workspacePath: string): Promise<string> {
	if (!workspacePath) {
		return ""
	}
	try {
		const dir = path.join(SESSIONS_DIR, workspaceHash(workspacePath))
		const entries = await fs.readdir(dir).catch(() => [])
		if (entries.length === 0) {
			return ""
		}
		// Files are ISO-timestamped, so lexical sort matches chronological
		entries.sort()
		const newest = entries[entries.length - 1]
		const newestPath = path.join(dir, newest)
		const stat = await fs.stat(newestPath)
		if (Date.now() - stat.mtimeMs > LAST_SESSION_MAX_AGE_MS) {
			return ""
		}
		const content = await fs.readFile(newestPath, "utf-8")
		// Wrap so the agent / user know what this is
		return [
			"\n\n## Previous session in this workspace (LuciBuild)",
			"",
			"Most recent task summary from your last work in this directory. If the user asks to",
			'"continue", "resume", or "pick up where we left off", use this as your starting context.',
			"",
			content.trim(),
			"",
		].join("\n")
	} catch (err) {
		Logger.warn(`SessionContinuity: failed to load last summary: ${(err as Error).message}`)
		return ""
	}
}
