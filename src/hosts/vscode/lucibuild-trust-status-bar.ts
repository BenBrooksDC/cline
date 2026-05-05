import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

// LuciBuild Round T (G3): trust status-bar widget.
//
// Shows `[ckpt Xm · N edits · audit]` to the left of the existing usage
// status bar. Click → opens the action audit log so the user can inspect
// recent tool activity.
//
// Cheap polling (5s) of the audit log mtime + line count. We don't keep
// state in memory — the audit log file IS the state.

const AUDIT_LOG_PATH = path.join(os.homedir(), ".claude", "lucibuild-actions.jsonl")

interface RecentSummary {
	count24h: number
	mostRecentTs?: string
	mostRecentTool?: string
	mostRecentOutcome?: string
}

function readRecentSummary(): RecentSummary {
	try {
		if (!fs.existsSync(AUDIT_LOG_PATH)) {
			return { count24h: 0 }
		}
		const raw = fs.readFileSync(AUDIT_LOG_PATH, "utf-8")
		const lines = raw.trim().split("\n")
		const now = Date.now()
		const cutoff = now - 24 * 60 * 60 * 1000
		let count = 0
		let mostRecentTs: string | undefined
		let mostRecentTool: string | undefined
		let mostRecentOutcome: string | undefined
		// Walk from the end so we find the most recent first
		for (let i = lines.length - 1; i >= 0; i--) {
			try {
				const evt = JSON.parse(lines[i]) as { ts?: string; tool?: string; outcome?: string }
				if (!evt.ts) {
					continue
				}
				const t = Date.parse(evt.ts)
				if (Number.isNaN(t)) {
					continue
				}
				if (!mostRecentTs) {
					mostRecentTs = evt.ts
					mostRecentTool = evt.tool
					mostRecentOutcome = evt.outcome
				}
				if (t < cutoff) {
					break
				}
				count++
			} catch {
				// skip malformed lines
			}
		}
		return { count24h: count, mostRecentTs, mostRecentTool, mostRecentOutcome }
	} catch {
		return { count24h: 0 }
	}
}

function formatRelative(ts: string): string {
	const diffMs = Date.now() - Date.parse(ts)
	if (Number.isNaN(diffMs) || diffMs < 0) {
		return "just now"
	}
	const minutes = Math.floor(diffMs / 60_000)
	if (minutes < 1) {
		return "just now"
	}
	if (minutes < 60) {
		return `${minutes}m ago`
	}
	const hours = Math.floor(minutes / 60)
	if (hours < 24) {
		return `${hours}h ago`
	}
	const days = Math.floor(hours / 24)
	return `${days}d ago`
}

export function registerTrustStatusBar(context: vscode.ExtensionContext): void {
	// Priority 99 → sits to the LEFT of the usage status bar (priority 100).
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
	item.command = "lucibuild.showActionAuditLog"
	item.show()

	const update = () => {
		const summary = readRecentSummary()
		if (summary.count24h === 0 || !summary.mostRecentTs) {
			item.text = "$(shield) LuciBuild trust"
			item.tooltip = "LuciBuild trust: no destructive tool activity in the last 24 hours.\nClick to open the audit log."
			return
		}
		const rel = formatRelative(summary.mostRecentTs)
		item.text = `$(shield) ${rel} · ${summary.count24h} edits`
		const lines = [
			`LuciBuild trust status`,
			``,
			`Last action: ${summary.mostRecentTool ?? "unknown"} (${summary.mostRecentOutcome ?? "?"})`,
			`When: ${rel}`,
			`Last 24h: ${summary.count24h} destructive tool calls`,
			``,
			`Click to open the action audit log.`,
		]
		item.tooltip = lines.join("\n")
		// Tint the badge red if the most recent outcome was a rollback or error.
		if (summary.mostRecentOutcome === "rolled_back" || summary.mostRecentOutcome === "errored") {
			item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground")
		} else {
			item.backgroundColor = undefined
		}
	}

	update()
	const timer = setInterval(update, 5000)

	const showLogCmd = vscode.commands.registerCommand("lucibuild.showActionAuditLog", async () => {
		try {
			const doc = await vscode.workspace.openTextDocument(AUDIT_LOG_PATH)
			await vscode.window.showTextDocument(doc, { preview: false })
		} catch {
			vscode.window.showInformationMessage(
				`No action audit log yet. It will be created at ${AUDIT_LOG_PATH} after the first destructive tool call.`,
			)
		}
	})

	context.subscriptions.push(item, showLogCmd, { dispose: () => clearInterval(timer) })
}
