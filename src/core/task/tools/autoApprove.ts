import { resolveWorkspacePath } from "@core/workspace"
import { isMultiRootEnabled } from "@core/workspace/multi-root-utils"
import { ClineDefaultTool } from "@shared/tools"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { getCwd, getDesktopDir, isLocatedInPath, isLocatedInWorkspace } from "@/utils/path"
import { isClaudeCodeAllowlisted } from "./claudeCodePermissions"

// LuciBuild Round T: tools that mutate state (writes / patches).
// When high-stakes mode is on, these always require user approval, regardless
// of any other auto-approve setting. Reads stay frictionless.
//
// BASH is intentionally NOT in this set. Reason: GT4 (blastRadius.ts) already
// forces manual approval for actually-destructive commands (rm -rf, git reset
// --hard, dropdb, etc.) regardless of any setting. Adding BASH here would
// double-gate every command — including safe ones like `ls`, `git status`,
// `npm test` — which leaves approval prompts sitting unattended in the chat,
// blowing the prompt-cache TTL and causing user-visible "freezes". The
// executeSafeCommands / executeAllCommands toggles are the right knobs for
// command auto-approval; high-stakes layers on top of those for FILE writes.
const MUTATING_TOOLS: ReadonlySet<ClineDefaultTool> = new Set([
	ClineDefaultTool.NEW_RULE,
	ClineDefaultTool.FILE_NEW,
	ClineDefaultTool.FILE_EDIT,
	ClineDefaultTool.APPLY_PATCH,
])

export class AutoApprove {
	private stateManager: StateManager
	// Cache for workspace paths - populated on first access and reused for the task lifetime
	// NOTE: This assumes that the task has a fixed set of workspace roots(which is currently true).
	private workspacePathsCache: { paths: string[] } | null = null
	private isMultiRootScenarioCache: boolean | null = null

	constructor(stateManager: StateManager) {
		this.stateManager = stateManager
	}

	/**
	 * Get workspace information with caching to avoid repeated API calls
	 * Cache is task-scoped since each task gets a new AutoApprove instance
	 */
	private async getWorkspaceInfo(): Promise<{
		workspacePaths: { paths: string[] }
		isMultiRootScenario: boolean
	}> {
		// Check if we already have cached values
		if (this.workspacePathsCache === null || this.isMultiRootScenarioCache === null) {
			// First time - fetch and cache for the lifetime of this task
			this.workspacePathsCache = await HostProvider.workspace.getWorkspacePaths({})
			this.isMultiRootScenarioCache = isMultiRootEnabled(this.stateManager) && this.workspacePathsCache.paths.length > 1
		}

		return {
			workspacePaths: this.workspacePathsCache,
			isMultiRootScenario: this.isMultiRootScenarioCache,
		}
	}

	// LuciBuild Round T: panic-button. When highStakesMode is on, mutating tools
	// always require approval — overrides yolo / autoApproveAll / per-action toggles
	// / Claude-Code allowlist. Reads stay frictionless.
	private isHighStakesBlocked(toolName: ClineDefaultTool): boolean {
		const settings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
		return settings?.highStakesMode === true && MUTATING_TOOLS.has(toolName)
	}

	// Check if the tool should be auto-approved based on the settings
	// Returns bool for most tools, and tuple for tools with nested settings
	shouldAutoApproveTool(toolName: ClineDefaultTool): boolean | [boolean, boolean] {
		if (this.isHighStakesBlocked(toolName)) {
			return false
		}
		if (this.stateManager.getGlobalSettingsKey("yoloModeToggled")) {
			switch (toolName) {
				case ClineDefaultTool.FILE_READ:
				case ClineDefaultTool.LIST_FILES:
				case ClineDefaultTool.LIST_CODE_DEF:
				case ClineDefaultTool.SEARCH:
				case ClineDefaultTool.NEW_RULE:
				case ClineDefaultTool.FILE_NEW:
				case ClineDefaultTool.FILE_EDIT:
				case ClineDefaultTool.APPLY_PATCH:
				case ClineDefaultTool.BASH:
				case ClineDefaultTool.USE_SUBAGENTS:
					return [true, true]

				case ClineDefaultTool.BROWSER:
				case ClineDefaultTool.WEB_FETCH:
				case ClineDefaultTool.WEB_SEARCH:
				case ClineDefaultTool.MCP_ACCESS:
				case ClineDefaultTool.MCP_USE:
					return true
			}
		}

		if (this.stateManager.getGlobalSettingsKey("autoApproveAllToggled")) {
			switch (toolName) {
				case ClineDefaultTool.FILE_READ:
				case ClineDefaultTool.LIST_FILES:
				case ClineDefaultTool.LIST_CODE_DEF:
				case ClineDefaultTool.SEARCH:
				case ClineDefaultTool.NEW_RULE:
				case ClineDefaultTool.FILE_NEW:
				case ClineDefaultTool.FILE_EDIT:
				case ClineDefaultTool.APPLY_PATCH:
				case ClineDefaultTool.BASH:
				case ClineDefaultTool.USE_SUBAGENTS:
					return [true, true]
				case ClineDefaultTool.BROWSER:
				case ClineDefaultTool.WEB_FETCH:
				case ClineDefaultTool.WEB_SEARCH:
				case ClineDefaultTool.MCP_ACCESS:
				case ClineDefaultTool.MCP_USE:
					return true
			}
		}

		const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")

		switch (toolName) {
			case ClineDefaultTool.FILE_READ:
			case ClineDefaultTool.LIST_FILES:
			case ClineDefaultTool.LIST_CODE_DEF:
			case ClineDefaultTool.SEARCH:
			case ClineDefaultTool.USE_SUBAGENTS:
				return [autoApprovalSettings.actions.readFiles, autoApprovalSettings.actions.readFilesExternally ?? false]
			case ClineDefaultTool.NEW_RULE:
			case ClineDefaultTool.FILE_NEW:
			case ClineDefaultTool.FILE_EDIT:
			case ClineDefaultTool.APPLY_PATCH:
				return [autoApprovalSettings.actions.editFiles, autoApprovalSettings.actions.editFilesExternally ?? false]
			case ClineDefaultTool.BASH:
				return [
					autoApprovalSettings.actions.executeSafeCommands ?? false,
					autoApprovalSettings.actions.executeAllCommands ?? false,
				]
			case ClineDefaultTool.BROWSER:
				return autoApprovalSettings.actions.useBrowser
			case ClineDefaultTool.WEB_FETCH:
			case ClineDefaultTool.WEB_SEARCH:
				return autoApprovalSettings.actions.useBrowser
			case ClineDefaultTool.MCP_ACCESS:
			case ClineDefaultTool.MCP_USE:
				return autoApprovalSettings.actions.useMcp
		}
		return false
	}

	// Check if the tool should be auto-approved based on the settings
	// and the path of the action. Returns true if the tool should be auto-approved
	// based on the user's settings and the path of the action.
	async shouldAutoApproveToolWithPath(
		blockname: ClineDefaultTool,
		autoApproveActionpath: string | undefined,
	): Promise<boolean> {
		if (this.isHighStakesBlocked(blockname)) {
			return false
		}
		if (this.stateManager.getGlobalSettingsKey("yoloModeToggled")) {
			return true
		}
		if (this.stateManager.getGlobalSettingsKey("autoApproveAllToggled")) {
			return true
		}
		// LuciBuild fork: honor Claude-Code-style pattern pre-approval from
		// ~/.claude/settings.json (permissions.allow). Lets the user configure
		// fine-grained allowlists once and have them apply across both ecosystems.
		if (isClaudeCodeAllowlisted(blockname, autoApproveActionpath)) {
			return true
		}

		let isLocalRead = false
		if (autoApproveActionpath) {
			// Use cached workspace info instead of fetching every time
			const { isMultiRootScenario } = await this.getWorkspaceInfo()

			if (isMultiRootScenario) {
				// Multi-root: check if file is in ANY workspace
				isLocalRead = await isLocatedInWorkspace(autoApproveActionpath)
			} else {
				// Single-root: use existing logic
				const cwd = await getCwd(getDesktopDir())
				// When called with a string cwd, resolveWorkspacePath returns a string
				const absolutePath = resolveWorkspacePath(
					cwd,
					autoApproveActionpath,
					"AutoApprove.shouldAutoApproveToolWithPath",
				) as string
				isLocalRead = isLocatedInPath(cwd, absolutePath)
			}
		} else {
			// If we do not get a path for some reason, default to a (safer) false return
			isLocalRead = false
		}

		// Get auto-approve settings for local and external edits
		const autoApproveResult = this.shouldAutoApproveTool(blockname)
		const [autoApproveLocal, autoApproveExternal] = Array.isArray(autoApproveResult)
			? autoApproveResult
			: [autoApproveResult, false]

		if ((isLocalRead && autoApproveLocal) || (!isLocalRead && autoApproveLocal && autoApproveExternal)) {
			return true
		}
		return false
	}
}
