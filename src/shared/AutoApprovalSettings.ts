export interface AutoApprovalSettings {
	// Version for race condition prevention (incremented on every change)
	version: number
	// Legacy field - kept for backward compatibility with older extension versions
	// Auto-approve is now always enabled by default
	enabled: boolean
	// Legacy field - kept for backward compatibility with older extension versions
	// Favorites feature has been removed
	favorites: string[]
	// Legacy field - kept for backward compatibility with older extension versions
	// Max requests limit feature has been removed
	maxRequests: number
	// Individual action permissions
	actions: {
		readFiles: boolean // Read files and directories in the working directory
		readFilesExternally?: boolean // Read files and directories outside of the working directory
		editFiles: boolean // Edit files in the working directory
		editFilesExternally?: boolean // Edit files outside of the working directory
		executeSafeCommands?: boolean // Execute safe commands
		executeAllCommands?: boolean // Execute all commands
		useBrowser: boolean // Use browser
		useMcp: boolean // Use MCP servers
	}
	// Global settings
	enableNotifications: boolean // Show notifications for approval and task completion
	// LuciBuild Round T: panic-button. When true, every mutating tool (write, patch,
	// command) prompts for approval regardless of the per-action auto-approve flags.
	// Reads still auto-approve so search/list isn't slowed down.
	highStakesMode?: boolean
	// LuciBuild Round T (GT3): auto-rollback when an edit introduces NEW
	// type/lint errors that weren't present before. Uses the just-created
	// pre-tool checkpoint (L2) as the rollback target. Default true — this is
	// the recommended trust default.
	autoRollbackOnTypeError?: boolean
}

export const DEFAULT_AUTO_APPROVAL_SETTINGS: AutoApprovalSettings = {
	version: 1,
	enabled: true, // Legacy field - always true by default
	favorites: [], // Legacy field - kept as empty array
	maxRequests: 20, // Legacy field - kept for backward compatibility
	actions: {
		// LuciBuild fork: enable read-anywhere + safe commands by default so the
		// agent can search/list/grep across the whole filesystem without prompting
		// (matches Claude Code's frictionless feel). Writes still require explicit
		// approval — those toggles stay off by default.
		readFiles: true,
		readFilesExternally: true,
		editFiles: false,
		editFilesExternally: false,
		executeSafeCommands: true,
		executeAllCommands: false,
		useBrowser: false,
		useMcp: true,
	},
	enableNotifications: false,
	// LuciBuild Round T: high-stakes mode defaults TRUE on new installs. The fork
	// is one day old as of 2026-05-05 and unverified at scale — every write,
	// patch, and command should prompt until the user has watched a few sessions
	// land cleanly and explicitly opts out via the auto-approve gear modal.
	// Reads remain frictionless so search/list/grep isn't slowed down.
	highStakesMode: true,
	autoRollbackOnTypeError: true,
}
