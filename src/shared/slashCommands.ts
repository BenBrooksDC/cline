export interface SlashCommand {
	name: string
	description?: string
	section?: "default" | "custom" | "mcp"
	cliCompatible?: boolean
}

export const BASE_SLASH_COMMANDS: SlashCommand[] = [
	{
		name: "newtask",
		description: "Create a new task with context from the current task",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "deep-planning",
		description: "Create a comprehensive implementation plan before coding",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "smol",
		description: "Condenses your current context window",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "newrule",
		description: "Create a new Cline rule based on your conversation",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "reportbug",
		description: "Create a Github issue with Cline",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "remember",
		description: "Save durable facts from this conversation to ~/.claude memory (LuciBuild)",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "install",
		description: "Source, install, and register a new tool (CLI / library / MCP server) (LuciBuild)",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "bootstrap",
		description: "Scaffold a starter project from a natural-language description (LuciBuild)",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "audit",
		description: "Run a dependency security audit and surface fixes (LuciBuild)",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "export-chat",
		description: "Export this conversation as a self-contained markdown playbook (LuciBuild)",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "template",
		description: "Save or run a reusable workflow template (LuciBuild)",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "pre-commit-review",
		description: "Senior-engineer review of your uncommitted diff before pushing (LuciBuild)",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "tdd",
		description: "Strict spec → failing test → minimum code → pass workflow (LuciBuild)",
		section: "default",
		cliCompatible: true,
	},
]

// VS Code-only slash commands
export const VSCODE_ONLY_COMMANDS: SlashCommand[] = [
	{
		name: "explain-changes",
		description: "Explain code changes between git refs (PRs, commits, branches, etc.)",
		section: "default",
	},
]

// CLI-only slash commands (handled locally, not sent to backend)
export const CLI_ONLY_COMMANDS: SlashCommand[] = [
	{
		name: "help",
		description: "Learn how to use Cline CLI",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "settings",
		description: "Change API provider, auto-approve, and feature settings",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "models",
		description: "Change the model used for the current mode",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "history",
		description: "Browse and search task history",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "clear",
		description: "Clear the current task and start fresh",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "exit",
		description: "Alternative to Ctrl+C",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "q",
		description: "Alternative to Ctrl+C",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "skills",
		description: "View and manage installed skills",
		section: "default",
		cliCompatible: true,
	},
]
