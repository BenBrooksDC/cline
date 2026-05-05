import { ClineDefaultTool } from "@shared/tools"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

/**
 * LuciBuild fork: Claude-Code-style path-pattern pre-approval.
 *
 * Reads ~/.claude/settings.json once per session and matches each tool call
 * against the user's `permissions.allow` patterns. Mirrors the Claude Code
 * convention so the same allowlist works in both ecosystems.
 *
 * Supported pattern shapes:
 *   - "Read(/abs/path/**)"          — auto-approves read/list/search for paths
 *                                     under that root (uses simple ** glob)
 *   - "Bash(<command-prefix>)"      — auto-approves shell commands whose
 *                                     command line starts with the prefix
 *   - "WebFetch", "WebSearch"       — bare tool names allow any use of that tool
 *   - "Read", "List", "Search"      — bare names allow ALL paths (use carefully)
 */

interface CachedAllowList {
	patterns: string[]
	loadedAt: number
}

const CACHE_TTL_MS = 30 * 1000 // 30s — picks up edits to settings.json without restarting
let cache: CachedAllowList | null = null

function loadAllowPatterns(): string[] {
	const now = Date.now()
	if (cache && now - cache.loadedAt < CACHE_TTL_MS) {
		return cache.patterns
	}
	const settingsPath = path.join(os.homedir(), ".claude", "settings.json")
	let patterns: string[] = []
	try {
		const raw = fs.readFileSync(settingsPath, "utf-8")
		const data = JSON.parse(raw) as { permissions?: { allow?: string[] } }
		patterns = data.permissions?.allow ?? []
	} catch {
		patterns = []
	}
	cache = { patterns, loadedAt: now }
	return patterns
}

/** Convert a `**`-style glob to a regex. Supports leading wildcards like `~/foo/**`. */
function globToRegex(glob: string): RegExp {
	const expanded = glob.replace(/^~/, os.homedir())
	const escaped = expanded
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "::DOUBLESTAR::")
		.replace(/\*/g, "[^/]*")
		.replace(/::DOUBLESTAR::/g, ".*")
	return new RegExp("^" + escaped + "$")
}

const READ_TOOL_NAMES = new Set<string>([
	ClineDefaultTool.FILE_READ,
	ClineDefaultTool.LIST_FILES,
	ClineDefaultTool.LIST_CODE_DEF,
	ClineDefaultTool.SEARCH,
])

/**
 * Returns true if a Claude-Code-style pattern in ~/.claude/settings.json
 * pre-approves the given tool invocation. Returns false otherwise.
 *
 * @param toolName    Cline tool enum value
 * @param pathOrCmd   For path-tools: the absolute target path. For Bash: the command line.
 */
export function isClaudeCodeAllowlisted(toolName: ClineDefaultTool, pathOrCmd: string | undefined): boolean {
	const patterns = loadAllowPatterns()
	if (patterns.length === 0) {
		return false
	}

	// Bare tool-name patterns
	const bareNames = ["WebFetch", "WebSearch", "Read", "List", "Search", "Bash"]
	for (const pat of patterns) {
		if (bareNames.includes(pat)) {
			if (toolName === ClineDefaultTool.WEB_FETCH && pat === "WebFetch") return true
			if (toolName === ClineDefaultTool.WEB_SEARCH && pat === "WebSearch") return true
			if (READ_TOOL_NAMES.has(toolName) && (pat === "Read" || pat === "List" || pat === "Search")) return true
			if (toolName === ClineDefaultTool.BASH && pat === "Bash") return true
		}
	}

	// Read(<path-glob>) patterns
	if (READ_TOOL_NAMES.has(toolName) && pathOrCmd) {
		for (const pat of patterns) {
			const m = pat.match(/^Read\((.+)\)$/)
			if (!m) continue
			try {
				if (globToRegex(m[1]).test(pathOrCmd)) return true
			} catch {
				/* malformed pattern — skip */
			}
		}
	}

	// Bash(<command-prefix>) patterns
	if (toolName === ClineDefaultTool.BASH && pathOrCmd) {
		for (const pat of patterns) {
			const m = pat.match(/^Bash\((.+)\)$/)
			if (!m) continue
			const prefix = m[1].replace(/:\*$/, "") // tolerate trailing :* convention
			if (pathOrCmd.startsWith(prefix)) return true
		}
	}

	return false
}
