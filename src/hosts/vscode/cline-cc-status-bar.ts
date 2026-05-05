import * as vscode from "vscode"
import { UsageTracker } from "@/core/usage/UsageTracker"

/**
 * LuciBuild fork: VS Code status bar item that displays live cross-provider spend.
 * Refreshes every 5s. Click → opens the usage log file for inspection.
 */
export function registerUsageStatusBar(context: vscode.ExtensionContext): void {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
	item.command = "lucibuild.showUsageLog"
	item.tooltip = "LuciBuild: per-provider spend today. Click to open the usage log."
	item.show()

	const updateLabel = () => {
		const tracker = UsageTracker.get()
		const total = tracker.getDailySpend()
		const burn = tracker.getBurnRatePerMinute()

		// Decide an icon/color based on the WORST budget percentage across providers
		let level: "ok" | "warning" | "over" = "ok"
		for (const p of ["openai", "google", "anthropic", "xai"] as const) {
			const s = tracker.getBudgetStatus(p)
			if (s.level === "over") {
				level = "over"
				break
			}
			if (s.level === "warning") {
				level = "warning"
			}
		}

		const icon = level === "over" ? "$(error)" : level === "warning" ? "$(warning)" : "$(graph)"
		const burnStr = burn > 0 ? ` ($${burn.toFixed(3)}/min)` : ""
		item.text = `${icon} LuciBuild $${total.toFixed(2)}${burnStr}`

		if (level === "over") {
			item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground")
		} else if (level === "warning") {
			item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground")
		} else {
			item.backgroundColor = undefined
		}

		item.tooltip = "LuciBuild daily spend\n" + tracker.getSummary() + "\n\nClick to open usage log."
	}

	updateLabel()
	const timer = setInterval(updateLabel, 5000)

	const showUsageLog = vscode.commands.registerCommand("lucibuild.showUsageLog", async () => {
		const path = require("path") as typeof import("path")
		const os = require("os") as typeof import("os")
		const logPath = path.join(os.homedir(), ".claude", "lucibuild-usage.jsonl")
		try {
			const doc = await vscode.workspace.openTextDocument(logPath)
			await vscode.window.showTextDocument(doc, { preview: false })
		} catch {
			vscode.window.showInformationMessage(
				"No usage log yet. It will be created at ~/.claude/lucibuild-usage.jsonl after the first API call.",
			)
		}
	})

	context.subscriptions.push(item, showUsageLog, { dispose: () => clearInterval(timer) })
}
