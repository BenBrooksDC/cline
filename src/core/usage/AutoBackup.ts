import { spawn } from "child_process"
import * as fs from "fs"
import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { isEnabled as isCostlyFeatureEnabled } from "./CostlyFeatures"

// LuciBuild Round T (L3): periodic off-workspace tarball backup.
//
// Cline's shadow-git checkpoint system gives in-task recoverability. AutoBackup
// adds OFF-workspace recoverability that survives task deletion: every N edits
// or N minutes, write a tarball of the workspace to ~/backups/ excluding
// node_modules / .git / etc. Retention: keep last 30, delete files older than
// 7 days.
//
// Triggered from the action audit recorder + a coarse-grained interval timer
// inside the task lifecycle. We use the system `tar` binary because the node
// libraries are heavy and the platform we ship for (macOS / Linux) always has
// tar.

const BACKUPS_DIR = path.join(os.homedir(), "backups")
const EDITS_PER_TARBALL = 10
const MIN_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes
const RETENTION_MAX_FILES = 30
const RETENTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

const DEFAULT_EXCLUDES = [
	"node_modules",
	".git/objects/pack",
	"dist",
	"build",
	".next",
	"target",
	"__pycache__",
	".venv",
	"venv",
	".cache",
	"coverage",
	".pytest_cache",
	".turbo",
]

// Per-task backup state (small in-memory counter).
interface BackupState {
	editsSinceLastBackup: number
	lastBackupTs: number
}

const taskStates = new Map<string, BackupState>()

function getOrCreateState(taskId: string): BackupState {
	let state = taskStates.get(taskId)
	if (!state) {
		state = { editsSinceLastBackup: 0, lastBackupTs: 0 }
		taskStates.set(taskId, state)
	}
	return state
}

function ensureBackupsDir(): void {
	if (!fs.existsSync(BACKUPS_DIR)) {
		fs.mkdirSync(BACKUPS_DIR, { recursive: true })
	}
}

/**
 * Run `tar -czf` on the workspace, excluding the default heavy dirs.
 * Non-blocking: fires on a background process; failures are logged.
 */
async function runTarball(workspacePath: string, taskId: string): Promise<void> {
	ensureBackupsDir()
	const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
	const safeTaskId = taskId.slice(0, 12).replace(/[^a-zA-Z0-9_-]/g, "")
	const outPath = path.join(BACKUPS_DIR, `lucibuild-task-${safeTaskId}-${ts}.tar.gz`)
	const parent = path.dirname(workspacePath)
	const baseName = path.basename(workspacePath)

	const args: string[] = []
	for (const ex of DEFAULT_EXCLUDES) {
		args.push("--exclude", ex)
	}
	args.push("-czf", outPath, "-C", parent, baseName)

	return new Promise<void>((resolve) => {
		const child = spawn("tar", args, { stdio: "ignore" })
		const timer = setTimeout(() => {
			try {
				child.kill("SIGTERM")
			} catch {
				/* ignore */
			}
		}, 60_000)
		child.once("exit", (code) => {
			clearTimeout(timer)
			if (code === 0) {
				Logger.info(`LuciBuild AutoBackup: tarball created at ${outPath}`)
			} else {
				Logger.warn(`LuciBuild AutoBackup: tar exited with code ${code} for ${workspacePath}`)
			}
			resolve()
		})
		child.once("error", (err) => {
			clearTimeout(timer)
			Logger.warn(`LuciBuild AutoBackup: spawn tar failed: ${err.message}`)
			resolve()
		})
	})
}

/**
 * LuciBuild Round T (L4): GitHub mirror push.
 *
 * Behind the auto-github-mirror CostlyFeatures toggle (default OFF). When the
 * toggle is on AND the workspace has a real .git repo, after a tarball lands
 * we run `gh repo create --private` (idempotent — fails silently if it
 * already exists) and `git push origin HEAD`. Best-effort: any failure is
 * logged + swallowed so the user's task isn't blocked.
 */
async function maybeMirrorToGitHub(workspacePath: string): Promise<void> {
	try {
		const enabled = await isCostlyFeatureEnabled("auto-github-mirror")
		if (!enabled) {
			return
		}
		// Workspace must have its own .git for mirror push to make sense.
		if (!fs.existsSync(path.join(workspacePath, ".git"))) {
			return
		}
		const repoName = `lucibuild-mirror-${path.basename(workspacePath).replace(/[^a-zA-Z0-9_-]/g, "-")}`

		// Ensure remote `lucibuild-mirror` exists. Idempotent: try to add it,
		// ignore failure if it already exists. We point it at the gh-managed
		// private repo by name (gh resolves it to the user's account).
		await runShortLived("gh", ["repo", "create", repoName, "--private", "--source", workspacePath, "--push"], workspacePath)
		// Subsequent pushes: gh repo create's --push only works the first time;
		// follow-ups need an explicit git push.
		await runShortLived("git", ["push", "lucibuild-mirror", "HEAD"], workspacePath)
		Logger.info(`LuciBuild AutoBackup: mirror pushed for ${workspacePath} → ${repoName}`)
	} catch (err) {
		Logger.warn(`LuciBuild AutoBackup: mirror push failed: ${err instanceof Error ? err.message : String(err)}`)
	}
}

function runShortLived(cmd: string, args: string[], cwd: string): Promise<void> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { cwd, stdio: "ignore" })
		const timer = setTimeout(() => {
			try {
				child.kill("SIGTERM")
			} catch {
				/* ignore */
			}
		}, 30_000)
		child.once("exit", () => {
			clearTimeout(timer)
			resolve()
		})
		child.once("error", () => {
			clearTimeout(timer)
			resolve()
		})
	})
}

/**
 * Apply retention policy: keep last N files AND drop anything older than max age.
 * Idempotent + best-effort: failures don't block.
 */
async function applyRetention(): Promise<void> {
	try {
		ensureBackupsDir()
		const entries = await fsp.readdir(BACKUPS_DIR)
		const matching = entries.filter((name) => name.startsWith("lucibuild-task-") && name.endsWith(".tar.gz"))
		if (matching.length === 0) {
			return
		}
		const stats = await Promise.all(
			matching.map(async (name) => {
				const full = path.join(BACKUPS_DIR, name)
				try {
					const st = await fsp.stat(full)
					return { name, full, mtimeMs: st.mtimeMs }
				} catch {
					return null
				}
			}),
		)
		const valid = stats.filter((s): s is NonNullable<typeof s> => s !== null)
		valid.sort((a, b) => b.mtimeMs - a.mtimeMs) // newest first

		const now = Date.now()
		const toDelete: string[] = []
		for (let i = 0; i < valid.length; i++) {
			const entry = valid[i]
			const tooOld = now - entry.mtimeMs > RETENTION_MAX_AGE_MS
			const overCount = i >= RETENTION_MAX_FILES
			if (tooOld || overCount) {
				toDelete.push(entry.full)
			}
		}
		await Promise.all(
			toDelete.map((full) =>
				fsp.unlink(full).catch((e) => {
					Logger.warn(`LuciBuild AutoBackup: retention delete failed for ${full}: ${e.message}`)
				}),
			),
		)
		if (toDelete.length > 0) {
			Logger.info(`LuciBuild AutoBackup: retention removed ${toDelete.length} old tarballs`)
		}
	} catch (err) {
		Logger.warn(`LuciBuild AutoBackup: retention scan failed: ${err instanceof Error ? err.message : String(err)}`)
	}
}

/**
 * Called after every destructive tool action. Increments the per-task counter
 * and fires a tarball if either threshold (edits or time) is crossed.
 *
 * Non-blocking: returns immediately; the tarball runs in the background.
 */
export function notifyEdit(taskId: string, workspacePath: string): void {
	if (!taskId || !workspacePath || !fs.existsSync(workspacePath)) {
		return
	}
	const state = getOrCreateState(taskId)
	state.editsSinceLastBackup += 1
	const now = Date.now()
	const editsCrossed = state.editsSinceLastBackup >= EDITS_PER_TARBALL
	const timeCrossed = state.lastBackupTs > 0 && now - state.lastBackupTs >= MIN_INTERVAL_MS
	if (editsCrossed || (state.lastBackupTs === 0 && state.editsSinceLastBackup >= EDITS_PER_TARBALL) || timeCrossed) {
		state.editsSinceLastBackup = 0
		state.lastBackupTs = now
		// Fire and forget; never block the user's edit.
		void (async () => {
			await runTarball(workspacePath, taskId)
			await applyRetention()
			await maybeMirrorToGitHub(workspacePath)
		})()
	}
}

/**
 * Force-fire a tarball regardless of thresholds. Used by the close-of-task
 * hook (attempt_completion) so the final state is always captured.
 */
export function forceBackup(taskId: string, workspacePath: string): void {
	if (!taskId || !workspacePath || !fs.existsSync(workspacePath)) {
		return
	}
	const state = getOrCreateState(taskId)
	state.editsSinceLastBackup = 0
	state.lastBackupTs = Date.now()
	void (async () => {
		await runTarball(workspacePath, taskId)
		await applyRetention()
	})()
}
