import { existsSync } from "fs"
import { mkdir, readFile, writeFile } from "fs/promises"
import os from "os"
import * as path from "path"
import simpleGit from "simple-git"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"

// LuciBuild Round T (L1): Auto-init git for non-git workspaces.
//
// Cline's shadow-git checkpoint system gives in-task recoverability even when
// the workspace itself isn't a git repo. But shadow git is per-task — if the
// task ends or is deleted, the user loses cross-task recoverability. Real
// workspace git (cheap to add, survives forever) closes that gap.
//
// First-edit-in-a-non-git-workspace flow:
//   1. Check workspace for .git
//   2. If missing AND not in the skip-list: prompt user
//   3. On Yes: git init + sensible .gitignore + initial commit
//   4. On Don't-ask-again: write to skip-list, never prompt for this path
//   5. On No (this time only): skip; will re-prompt next session

const SKIPLIST_PATH = path.join(os.homedir(), ".claude", "lucibuild-autogit-skip.json")

const DEFAULT_GITIGNORE = `# LuciBuild auto-generated .gitignore
node_modules/
.venv/
venv/
__pycache__/
*.pyc
.DS_Store
.env
.env.local
*.log
dist/
build/
.next/
coverage/
.cache/
`

interface SkipList {
	paths: string[]
}

async function readSkipList(): Promise<SkipList> {
	try {
		const raw = await readFile(SKIPLIST_PATH, "utf-8")
		const data = JSON.parse(raw) as SkipList
		return { paths: Array.isArray(data.paths) ? data.paths : [] }
	} catch {
		return { paths: [] }
	}
}

async function addToSkipList(workspacePath: string): Promise<void> {
	const data = await readSkipList()
	const resolved = path.resolve(workspacePath)
	if (!data.paths.includes(resolved)) {
		data.paths.push(resolved)
		await mkdir(path.dirname(SKIPLIST_PATH), { recursive: true })
		await writeFile(SKIPLIST_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8")
	}
}

async function isSkipped(workspacePath: string): Promise<boolean> {
	const data = await readSkipList()
	return data.paths.includes(path.resolve(workspacePath))
}

function isGitRepo(workspacePath: string): boolean {
	return existsSync(path.join(workspacePath, ".git"))
}

async function runGitInit(workspacePath: string): Promise<void> {
	const git = simpleGit({ baseDir: workspacePath })
	await git.init()
	// Write .gitignore only if one doesn't already exist
	const gitignorePath = path.join(workspacePath, ".gitignore")
	if (!existsSync(gitignorePath)) {
		await writeFile(gitignorePath, DEFAULT_GITIGNORE, "utf-8")
	}
	await git.add(".")
	// allow-empty in case the workspace is empty
	await git.commit("lucibuild: snapshot before first edit", [], { "--allow-empty": null })
}

/**
 * Run before the shadow-git tracker initializes for a workspace.
 * Idempotent + non-blocking on failure: any error here is logged and swallowed
 * — the shadow git still initializes and the task proceeds.
 */
export async function maybeAutoInitWorkspaceGit(workspacePath: string): Promise<void> {
	try {
		if (isGitRepo(workspacePath)) {
			return
		}
		if (await isSkipped(workspacePath)) {
			return
		}

		const response = await HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: `LuciBuild: this workspace isn't a git repo. Initialize one for cross-session recoverability?`,
			options: {
				modal: false,
				items: ["Initialize", "Skip this time", "Never ask for this folder"],
				detail: `Path: ${workspacePath}\n\nLuciBuild already takes per-task checkpoints in a shadow repo. Initializing real git in the workspace adds cross-task history you can inspect with 'git log' and push to GitHub yourself.`,
			},
		})

		if (response.selectedOption === "Initialize") {
			await runGitInit(workspacePath)
			Logger.info(`LuciBuild AutoGitInit: initialized git in ${workspacePath}`)
		} else if (response.selectedOption === "Never ask for this folder") {
			await addToSkipList(workspacePath)
		}
		// "Skip this time" or no response: do nothing; we'll re-prompt next session.
	} catch (error) {
		Logger.warn(
			`LuciBuild AutoGitInit: skipped (non-blocking error) for ${workspacePath}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		)
	}
}
