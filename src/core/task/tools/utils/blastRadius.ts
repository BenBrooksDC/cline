import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import * as path from "path"

// LuciBuild Round T (GT4): blast-radius gate.
//
// Some commands and edits are catastrophically destructive — `rm -rf`,
// `git reset --hard`, `dropdb`, `replace_all` against a popular regex.
// These should NEVER auto-approve, even when the user has clicked
// "auto-approve all commands". They should always present a clear
// "here's what's about to happen" preview and ask for explicit consent.
//
// Pattern source: built-in defaults + optional user override at
// ~/.claude/destructive-commands.json. User-editable so false positives
// can be tuned (e.g., user-trusted internal CLI names).

const USER_PATTERNS_PATH = path.join(homedir(), ".claude", "destructive-commands.json")

const DEFAULT_DESTRUCTIVE_PATTERNS: RegExp[] = [
	/\brm\s+(-[rRfF]+\b|--recursive\b|--force\b)/, // rm -rf and friends
	/\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*[fF][a-zA-Z]*|-[a-zA-Z]*[fF][a-zA-Z]*[rR][a-zA-Z]*)\b/,
	/\bgit\s+reset\s+--hard\b/,
	/\bgit\s+clean\s+(-[a-zA-Z]*[fF][a-zA-Z]*|--force)\b/,
	/\bgit\s+push\s+(.*\s+)?(--force\b|--force-with-lease\b|-f\b)/,
	/\bgit\s+checkout\s+\.\b/,
	/\bgit\s+restore\s+\.\b/,
	/\bgit\s+branch\s+-D\b/,
	/\bdropdb\b/,
	/\bdrop\s+(database|table|schema|index)\b/i,
	/\btruncate\s+table\b/i,
	/\bDELETE\s+FROM\b(?!.*\bWHERE\b)/i, // DELETE without WHERE
	/\bUPDATE\b.*\bSET\b(?!.*\bWHERE\b)/i, // UPDATE without WHERE
	/\bmkfs\b/, // mkfs.*
	/\bdd\s+if=.*of=\/dev\//, // dd to a device
	/\bshred\b/,
	/\b:\(\)\{\s*:\|:&\s*\};:\b/, // fork bomb
	/\bsudo\s+rm\b/,
	/\bnpm\s+uninstall\b/, // dependency removal — high blast radius
	/\bpip\s+uninstall\b/,
	/\bbrew\s+uninstall\b/,
]

interface DestructiveConfig {
	patterns?: string[]
	disabled_default_indices?: number[]
}

let cachedUserPatterns: { patterns: RegExp[]; disabledDefaults: Set<number>; mtime: number } | null = null
const CACHE_TTL_MS = 30_000

function loadUserPatterns(): { patterns: RegExp[]; disabledDefaults: Set<number> } {
	const now = Date.now()
	if (cachedUserPatterns && now - cachedUserPatterns.mtime < CACHE_TTL_MS) {
		return { patterns: cachedUserPatterns.patterns, disabledDefaults: cachedUserPatterns.disabledDefaults }
	}
	const patterns: RegExp[] = []
	let disabledDefaults: Set<number> = new Set()
	try {
		if (existsSync(USER_PATTERNS_PATH)) {
			const raw = readFileSync(USER_PATTERNS_PATH, "utf-8")
			const data = JSON.parse(raw) as DestructiveConfig
			if (Array.isArray(data.patterns)) {
				for (const p of data.patterns) {
					try {
						patterns.push(new RegExp(p))
					} catch {
						// invalid pattern — skip
					}
				}
			}
			if (Array.isArray(data.disabled_default_indices)) {
				disabledDefaults = new Set(data.disabled_default_indices.filter((n) => Number.isInteger(n)))
			}
		}
	} catch {
		// ignore — falls back to defaults
	}
	cachedUserPatterns = { patterns, disabledDefaults, mtime: now }
	return { patterns, disabledDefaults }
}

export interface BlastRadiusResult {
	destructive: boolean
	matchedPattern?: string
	advice?: string
}

/**
 * Check if a shell command matches a destructive pattern. Used by
 * ExecuteCommandToolHandler to force approval regardless of auto-approve.
 */
export function classifyCommand(command: string): BlastRadiusResult {
	const { patterns: userPatterns, disabledDefaults } = loadUserPatterns()
	for (let i = 0; i < DEFAULT_DESTRUCTIVE_PATTERNS.length; i++) {
		if (disabledDefaults.has(i)) {
			continue
		}
		const pattern = DEFAULT_DESTRUCTIVE_PATTERNS[i]
		if (pattern.test(command)) {
			return {
				destructive: true,
				matchedPattern: pattern.source,
				advice: "This command is in LuciBuild's built-in destructive list. Approve only if you've reviewed it.",
			}
		}
	}
	for (const pattern of userPatterns) {
		if (pattern.test(command)) {
			return {
				destructive: true,
				matchedPattern: pattern.source,
				advice: "This command matched your custom destructive pattern.",
			}
		}
	}
	return { destructive: false }
}

/**
 * Blast-radius assessment for replace_all-style edits. Counts matches
 * and surfaces the first 3 sample sites so the user knows what's
 * about to happen across the file before approving.
 */
export interface ReplaceAllPreview {
	matchCount: number
	samples: { line: number; preview: string }[]
}

export function previewReplaceAll(content: string, needle: string): ReplaceAllPreview {
	if (!needle) {
		return { matchCount: 0, samples: [] }
	}
	const lines = content.split("\n")
	const samples: { line: number; preview: string }[] = []
	let matchCount = 0
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		// Count occurrences in this line (non-regex literal find)
		let idx = 0
		let occurrences = 0
		while ((idx = line.indexOf(needle, idx)) !== -1) {
			occurrences++
			idx += needle.length || 1
		}
		if (occurrences > 0) {
			matchCount += occurrences
			if (samples.length < 3) {
				samples.push({ line: i + 1, preview: line.length > 120 ? line.slice(0, 120) + "…" : line })
			}
		}
	}
	return { matchCount, samples }
}

/**
 * Blast-radius assessment for patch DELETE / MOVE operations. Returns
 * a human-readable summary the handler can show before applying.
 */
export function summarizeFileOperations(ops: { type: "delete" | "move"; path: string; size_bytes?: number }[]): string {
	if (ops.length === 0) {
		return ""
	}
	const lines: string[] = []
	const deletes = ops.filter((o) => o.type === "delete")
	const moves = ops.filter((o) => o.type === "move")
	if (deletes.length > 0) {
		lines.push(`Will DELETE ${deletes.length} file${deletes.length === 1 ? "" : "s"}:`)
		for (const d of deletes.slice(0, 5)) {
			lines.push(`  - ${d.path}${d.size_bytes != null ? ` (${d.size_bytes} bytes)` : ""}`)
		}
		if (deletes.length > 5) {
			lines.push(`  ...and ${deletes.length - 5} more`)
		}
	}
	if (moves.length > 0) {
		lines.push(`Will MOVE ${moves.length} file${moves.length === 1 ? "" : "s"}:`)
		for (const m of moves.slice(0, 5)) {
			lines.push(`  - ${m.path}`)
		}
		if (moves.length > 5) {
			lines.push(`  ...and ${moves.length - 5} more`)
		}
	}
	return lines.join("\n")
}
