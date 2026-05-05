import { access, constants, mkdir, readFile, writeFile } from "fs/promises"
import os from "os"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { getCwd, getDesktopDir } from "@/utils/path"

const CHECKPOINT_ALLOWLIST_PATH = path.join(os.homedir(), ".claude", "lucibuild-checkpoint-allowlist.json")
// One-time migration: rename old cline-cc-checkpoint-allowlist.json on first read
const LEGACY_CHECKPOINT_ALLOWLIST_PATH = path.join(os.homedir(), ".claude", "cline-cc-checkpoint-allowlist.json")

/**
 * Cline-CC fork: read the user's checkpoint-allowlist to decide whether a
 * normally-protected workspace path (Desktop, Documents, Downloads, home) is
 * explicitly approved by the user.
 */
async function isCheckpointAllowlisted(workspacePath: string): Promise<boolean> {
	// One-time migration of legacy filename
	try {
		const fs = await import("fs")
		if (fs.existsSync(LEGACY_CHECKPOINT_ALLOWLIST_PATH) && !fs.existsSync(CHECKPOINT_ALLOWLIST_PATH)) {
			fs.renameSync(LEGACY_CHECKPOINT_ALLOWLIST_PATH, CHECKPOINT_ALLOWLIST_PATH)
		}
	} catch {
		/* ignore */
	}
	try {
		const raw = await readFile(CHECKPOINT_ALLOWLIST_PATH, "utf-8")
		const data = JSON.parse(raw) as { paths?: string[] }
		const list = (data.paths ?? []).map((p) => path.resolve(p.replace(/^~/, os.homedir())))
		return list.includes(path.resolve(workspacePath))
	} catch {
		return false
	}
}

/**
 * Cline-CC fork: persist a path to the checkpoint allowlist so future sessions don't re-prompt.
 */
async function addToCheckpointAllowlist(workspacePath: string): Promise<void> {
	let data: { paths: string[] } = { paths: [] }
	try {
		const raw = await readFile(CHECKPOINT_ALLOWLIST_PATH, "utf-8")
		data = JSON.parse(raw)
		if (!Array.isArray(data.paths)) {
			data.paths = []
		}
	} catch {
		// missing file is fine
	}
	const resolved = path.resolve(workspacePath)
	if (!data.paths.includes(resolved)) {
		data.paths.push(resolved)
		await mkdir(path.dirname(CHECKPOINT_ALLOWLIST_PATH), { recursive: true })
		await writeFile(CHECKPOINT_ALLOWLIST_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8")
	}
}

/**
 * Cline-CC fork: prompt the user to approve checkpoints in a normally-protected directory.
 * Returns true if the user approved (and persists to the allowlist), false otherwise.
 */
async function promptToApproveCheckpointDir(workspacePath: string, label: string): Promise<boolean> {
	try {
		const response = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: `LuciBuild: ${label} is a protected directory. Allow checkpoints (auto-git snapshots) here for this folder?`,
			options: {
				modal: false,
				items: ["Approve and remember", "Cancel"],
				detail: `Path: ${workspacePath}\n\nApproving writes this path to ${CHECKPOINT_ALLOWLIST_PATH} so you won't be asked again.`,
			},
		})
		if (response.selectedOption === "Approve and remember") {
			await addToCheckpointAllowlist(workspacePath)
			return true
		}
	} catch {
		// If the prompt mechanism fails for any reason, fall back to deny
	}
	return false
}

/**
 * Gets the path to the shadow Git repository in globalStorage.
 *
 * Checkpoints path structure:
 * globalStorage/
 *   checkpoints/
 *     {cwdHash}/
 *       .git/
 *
 * @param cwdHash - Hash of the working directory path
 * @returns Promise<string> The absolute path to the shadow git directory
 * @throws Error if global storage path is invalid
 */
export async function getShadowGitPath(cwdHash: string): Promise<string> {
	const checkpointsDir = path.join(HostProvider.get().globalStorageFsPath, "checkpoints", cwdHash)
	await mkdir(checkpointsDir, { recursive: true })
	const gitPath = path.join(checkpointsDir, ".git")
	return gitPath
}

/**
 * Validates that a workspace path is safe for checkpoints.
 * Checks that checkpoints are not being used in protected directories
 * like home, Desktop, Documents, or Downloads. Also confirms that the workspace
 * is accessible and that we will not encounter breaking permissions issues when
 * creating checkpoints.
 *
 * Protected directories:
 * - User's home directory
 * - Desktop
 * - Documents
 * - Downloads
 *
 * @param workspacePath - The absolute path to the workspace directory to validate
 * @returns Promise<void> Resolves if the path is valid
 * @throws Error if the path is in a protected directory or if no read access
 */
export async function validateWorkspacePath(workspacePath: string): Promise<void> {
	// Check if directory exists and we have read permissions
	try {
		await access(workspacePath, constants.R_OK)
	} catch (error) {
		throw new Error(
			`Cannot access workspace directory. Please ensure VS Code has permission to access your workspace. Error: ${error instanceof Error ? error.message : String(error)}`,
		)
	}

	// Cline-CC: if the user has previously approved this path, skip the protected-dir check
	if (await isCheckpointAllowlisted(workspacePath)) {
		return
	}

	const homedir = os.homedir()
	const desktopPath = getDesktopDir()
	const documentsPath = path.join(homedir, "Documents")
	const downloadsPath = path.join(homedir, "Downloads")

	let label: string | null = null
	switch (workspacePath) {
		case homedir:
			label = "home directory"
			break
		case desktopPath:
			label = "Desktop directory"
			break
		case documentsPath:
			label = "Documents directory"
			break
		case downloadsPath:
			label = "Downloads directory"
			break
	}

	if (label) {
		// Cline-CC: ask the user to approve instead of hard-erroring
		const approved = await promptToApproveCheckpointDir(workspacePath, label)
		if (!approved) {
			throw new Error(`Cannot use checkpoints in ${label} (user declined approval)`)
		}
	}
}

/**
 * Gets the current working directory from the VS Code workspace.
 * Validates that checkpoints are not being used in protected directories
 * like home, Desktop, Documents, or Downloads. Checks to confirm that the workspace
 * is accessible and that we will not encounter breaking permissions issues when
 * creating checkpoints.
 *
 * Protected directories:
 * - User's home directory
 * - Desktop
 * - Documents
 * - Downloads
 *
 * @returns Promise<string> The absolute path to the current working directory
 * @throws Error if no workspace is detected, if in a protected directory, or if no read access
 */
export async function getWorkingDirectory(): Promise<string> {
	const cwd = await getCwd()
	if (!cwd) {
		throw new Error("No workspace detected. Please open Cline in a workspace to use checkpoints.")
	}

	await validateWorkspacePath(cwd)
	return cwd
}

/**
 * Hashes the current working directory to a 13-character numeric hash.
 * @param workingDir - The absolute path to the working directory
 * @returns A 13-character numeric hash string used to identify the workspace
 * @throws {Error} If the working directory path is empty or invalid
 */
export function hashWorkingDir(workingDir: string): string {
	if (!workingDir) {
		throw new Error("Working directory path cannot be empty")
	}
	let hash = 0
	for (let i = 0; i < workingDir.length; i++) {
		hash = (hash * 31 + workingDir.charCodeAt(i)) >>> 0
	}
	const bigHash = BigInt(hash)
	const numericHash = bigHash.toString().slice(0, 13)
	return numericHash
}
