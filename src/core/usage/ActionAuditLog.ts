import * as fs from "fs"
import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

// LuciBuild Round T (GT5): tool-action audit log.
//
// Every destructive tool call (write_to_file, replace_in_file, apply_patch,
// execute_command, new_rule, new_task) emits one line here. Pairs with
// UsageTracker (LLM calls) so a session can be reconstructed end-to-end:
// what the agent thought + what the agent did.
//
// Append-only JSONL at ~/.claude/lucibuild-actions.jsonl. Sync writes in the
// hot path (we don't want to lose events on a crash). Reader-friendly: one
// JSON object per line, never multi-line.

const AUDIT_LOG_PATH = path.join(os.homedir(), ".claude", "lucibuild-actions.jsonl")

export type ActionTool =
	| "write_to_file"
	| "replace_in_file"
	| "apply_patch"
	| "execute_command"
	| "new_rule"
	| "new_task"
	| "browser_action"
	| "use_mcp_tool"

export type ActionOutcome = "approved" | "rejected" | "auto_approved" | "completed" | "errored" | "rolled_back"

export interface ActionEvent {
	ts: string
	task_id?: string
	tool: ActionTool
	outcome: ActionOutcome
	// Sanitized params: paths, model names, command first-token. Never full bodies.
	params: Record<string, string | number | boolean | undefined>
	pre_checkpoint_id?: string
	post_checkpoint_id?: string
	latency_ms?: number
	error?: string
}

function ensureLogDir(): void {
	const dir = path.dirname(AUDIT_LOG_PATH)
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}
}

/**
 * Sanitize tool params before logging. We DO NOT log full file contents,
 * full diffs, or full prompts — too big and may contain secrets the user
 * wouldn't want in a log file. We DO log paths, command first-token,
 * line counts, and any boolean flags.
 */
export function sanitizeParams(tool: ActionTool, raw: Record<string, unknown>): ActionEvent["params"] {
	const out: ActionEvent["params"] = {}
	const safeStringFields = ["path", "file_path", "old_path", "new_path", "model", "operation", "patch_type"]
	for (const key of safeStringFields) {
		const val = raw[key]
		if (typeof val === "string" && val.length < 512) {
			out[key] = val
		}
	}
	if (typeof raw.command === "string") {
		// Just the first token (program name) — keeps PII / secrets out
		const firstToken = raw.command.trim().split(/\s+/)[0] ?? ""
		out.command_program = firstToken.slice(0, 64)
	}
	if (typeof raw.content === "string") {
		out.content_lines = raw.content.split("\n").length
		out.content_bytes = Buffer.byteLength(raw.content, "utf-8")
	}
	if (typeof raw.diff === "string") {
		out.diff_lines = raw.diff.split("\n").length
		out.diff_bytes = Buffer.byteLength(raw.diff, "utf-8")
	}
	if (typeof raw.replace_all === "boolean") {
		out.replace_all = raw.replace_all
	}
	if (typeof raw.requires_approval === "boolean") {
		out.requires_approval = raw.requires_approval
	}
	return out
}

/**
 * Append a single audit event. Sync write — small payload, hot path, must
 * not be lost. Failures are logged + swallowed: never block the agent
 * because of an audit log issue.
 */
export function recordAction(event: ActionEvent): void {
	try {
		ensureLogDir()
		fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(event) + "\n", "utf-8")
	} catch (error) {
		Logger.warn(`LuciBuild ActionAuditLog: write failed: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * Convenience builder used by tool handlers.
 */
export function buildActionEvent(args: {
	tool: ActionTool
	outcome: ActionOutcome
	taskId?: string
	rawParams: Record<string, unknown>
	preCheckpointId?: string
	postCheckpointId?: string
	latencyMs?: number
	error?: string
}): ActionEvent {
	return {
		ts: new Date().toISOString(),
		task_id: args.taskId,
		tool: args.tool,
		outcome: args.outcome,
		params: sanitizeParams(args.tool, args.rawParams),
		pre_checkpoint_id: args.preCheckpointId,
		post_checkpoint_id: args.postCheckpointId,
		latency_ms: args.latencyMs,
		error: args.error,
	}
}

/**
 * Read the last N events for the current task — used by the chat header
 * to surface recent activity ("3 edits in last 5 min"). Returns [] on any
 * read error.
 */
export async function readRecentActions(taskId: string, limit = 50): Promise<ActionEvent[]> {
	try {
		const raw = await fsp.readFile(AUDIT_LOG_PATH, "utf-8")
		const lines = raw.trim().split("\n").reverse()
		const out: ActionEvent[] = []
		for (const line of lines) {
			if (out.length >= limit) {
				break
			}
			try {
				const event = JSON.parse(line) as ActionEvent
				if (event.task_id === taskId) {
					out.push(event)
				}
			} catch {}
		}
		return out.reverse()
	} catch {
		return []
	}
}
