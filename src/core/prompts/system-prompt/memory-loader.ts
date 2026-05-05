import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

const MEMORY_INDEX_FILENAME = "MEMORY.md"
const MAX_BYTES = 32000
const TRUNCATION_MESSAGE = "\n\n[... memory index truncated at 32000 bytes ...]"

/**
 * Loads the Claude-Code-style memory index from
 * `~/.claude/projects/-Users-<username>/memory/MEMORY.md` for automatic context
 * injection. The index lists each memory file with a short description; the agent
 * lazily reads individual memory files via the Read tool when needed.
 *
 * This is a Cline-CC fork addition. Returns the wrapped index string, or "" if no
 * memory dir exists for this user (preserves upstream behavior on machines
 * without Claude Code installed).
 */
export async function loadClineCodeMemoryIndex(): Promise<string> {
	try {
		const homeDir = os.homedir()
		// Mirror Claude Code's per-user memory project dir convention:
		// ~/.claude/projects/-Users-<username>/memory/
		const username = path.basename(homeDir)
		const memoryDir = path.join(homeDir, ".claude", "projects", `-Users-${username}`, "memory")
		const indexPath = path.join(memoryDir, MEMORY_INDEX_FILENAME)

		let indexContent: string
		try {
			indexContent = await fs.readFile(indexPath, "utf-8")
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (code === "ENOENT" || code === "ENOTDIR") {
				return ""
			}
			throw error
		}

		if (!indexContent.trim()) {
			return ""
		}

		// Truncate if oversized (defensive — typical index is ~3KB)
		let body = indexContent
		if (Buffer.byteLength(body, "utf-8") > MAX_BYTES) {
			body = Buffer.from(body, "utf-8").slice(0, MAX_BYTES).toString("utf-8") + TRUNCATION_MESSAGE
		}

		return [
			"\n\n## Auto-loaded user memories (Cline-CC)",
			"",
			`Memory files live at: ${memoryDir}`,
			"Each entry below is a separate markdown file in that directory. Read individual files",
			"on demand via the Read tool when their topic is relevant — do not assume their full",
			"contents from the one-line summary alone.",
			"",
			body.trim(),
			"",
		].join("\n")
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		Logger.warn(`Cline-CC: Failed to load memory index. Error: ${message}`)
		return ""
	}
}
