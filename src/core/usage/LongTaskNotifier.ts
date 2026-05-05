import { exec } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

const COMPLETED_LOG_PATH = path.join(os.homedir(), ".claude", "lucibuild-completed-tasks.jsonl")
const DEFAULT_THRESHOLD_MS = 2 * 60 * 1000 // 2 minutes

/**
 * LuciBuild fork: track per-task wall-time and fire a notification when a task
 * runs longer than the threshold and finishes. Reuses the user's existing
 * macOS notification infra (osascript). Writes a JSONL log of completed tasks
 * for later analysis.
 *
 * Hook points:
 *   - LongTaskNotifier.get().start(taskId, taskText) — call when a task begins
 *   - LongTaskNotifier.get().end(taskId, status) — call on completion or cancellation
 */
export class LongTaskNotifier {
	private static _instance: LongTaskNotifier | undefined
	private active = new Map<string, { startedAt: number; taskText: string }>()
	private thresholdMs: number = DEFAULT_THRESHOLD_MS

	static get(): LongTaskNotifier {
		if (!LongTaskNotifier._instance) {
			LongTaskNotifier._instance = new LongTaskNotifier()
		}
		return LongTaskNotifier._instance
	}

	setThreshold(ms: number): void {
		this.thresholdMs = ms
	}

	start(taskId: string, taskText: string): void {
		this.active.set(taskId, { startedAt: Date.now(), taskText })
	}

	end(taskId: string, status: "completed" | "cancelled" | "error"): void {
		const entry = this.active.get(taskId)
		if (!entry) return
		this.active.delete(taskId)
		const elapsedMs = Date.now() - entry.startedAt
		const event = {
			ts: new Date().toISOString(),
			task_id: taskId,
			task_text: entry.taskText.slice(0, 200),
			elapsed_ms: elapsedMs,
			status,
		}
		// Append to JSONL (best effort)
		try {
			fs.mkdirSync(path.dirname(COMPLETED_LOG_PATH), { recursive: true })
			fs.appendFileSync(COMPLETED_LOG_PATH, JSON.stringify(event) + "\n", "utf-8")
		} catch (err) {
			Logger.warn(`LongTaskNotifier: failed to log: ${(err as Error).message}`)
		}
		// Fire notification if elapsed > threshold AND we're on macOS
		if (elapsedMs >= this.thresholdMs && process.platform === "darwin") {
			const minutes = (elapsedMs / 60000).toFixed(1)
			const verb = status === "completed" ? "finished" : status === "cancelled" ? "cancelled" : "errored"
			const title = `LuciBuild ${verb} (${minutes}m)`
			const preview = entry.taskText
				.replace(/[\r\n]+/g, " ")
				.slice(0, 80)
				.replace(/"/g, "'")
			const body = preview || "Task done."
			try {
				exec(`osascript -e 'display notification "${body}" with title "${title}" sound name "Glass"'`, () => {
					/* fire-and-forget */
				})
			} catch {
				/* ignore */
			}
		}
	}
}
