import { ClineAsk, ClineSayTool } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@shared/tools"
import { spawn } from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { ToolResponse } from "../.."
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

const RELAY_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes — relay calls can be slow for large outputs

/**
 * Cline-CC fork tool handler: invokes the user's external LLM Relay CLI
 * (`python3 ~/llm-connector/llm.py <model> -f <prompt_file>`) so the agent can
 * delegate heavy generation to GPT/Gemini/Grok and preserve the Anthropic quota.
 */
export class LLMRelayToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.LLM_RELAY

	getDescription(block: ToolUse): string {
		const model = block.params.model || "?"
		const promptFile = block.params.prompt_file || "?"
		return `[${block.name} model=${model} prompt_file=${promptFile}]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const model = block.params.model || ""
		const promptFile = block.params.prompt_file || ""
		const sharedMessageProps: ClineSayTool = {
			tool: "webSearch",
			path: uiHelpers.removeClosingTag(block, "model", model),
			content: `LLM Relay: ${uiHelpers.removeClosingTag(
				block,
				"model",
				model,
			)} <- ${uiHelpers.removeClosingTag(block, "prompt_file", promptFile)}`,
			operationIsLocatedInWorkspace: false,
		}
		const partialMessage = JSON.stringify(sharedMessageProps)
		await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
		await uiHelpers.ask("tool" as ClineAsk, partialMessage, block.partial).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const model = block.params.model
		const promptFile = block.params.prompt_file
		const outputFile = block.params.output_file

		if (!model) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "model")
		}
		if (!promptFile) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "prompt_file")
		}
		config.taskState.consecutiveMistakeCount = 0

		// Validate prompt_file exists
		try {
			await fs.access(promptFile, fs.constants.R_OK)
		} catch {
			return formatResponse.toolError(
				`prompt_file does not exist or is not readable: ${promptFile}. Use the Write tool to create the spec file first.`,
			)
		}

		// Approval flow
		const sharedMessageProps: ClineSayTool = {
			tool: "webSearch",
			path: model,
			content: `LLM Relay: ${model} <- ${promptFile}${outputFile ? " -> " + outputFile : ""}`,
			operationIsLocatedInWorkspace: false,
		}
		const completeMessage = JSON.stringify(sharedMessageProps)

		if (config.callbacks.shouldAutoApproveTool(this.name)) {
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
		} else {
			showNotificationForApproval(
				`Cline-CC wants to delegate to ${model} via the LLM Relay`,
				config.autoApprovalSettings.enableNotifications,
			)
			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")
			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)
			if (!didApprove) {
				return formatResponse.toolDenied()
			}
		}

		// Locate the relay CLI
		const relayPath = path.join(os.homedir(), "llm-connector", "llm.py")
		try {
			await fs.access(relayPath, fs.constants.R_OK)
		} catch {
			return formatResponse.toolError(`LLM Relay CLI not found at ${relayPath}. Install it before using this tool.`)
		}

		// Spawn python3 ~/llm-connector/llm.py <model> -f <promptFile>
		const result = await new Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }>(
			(resolve) => {
				const child = spawn("python3", [relayPath, model, "-f", promptFile], {
					stdio: ["ignore", "pipe", "pipe"],
				})
				let stdout = ""
				let stderr = ""
				let timedOut = false
				const timeout = setTimeout(() => {
					timedOut = true
					child.kill("SIGTERM")
				}, RELAY_TIMEOUT_MS)
				child.stdout.on("data", (chunk: Buffer) => {
					stdout += chunk.toString("utf-8")
				})
				child.stderr.on("data", (chunk: Buffer) => {
					stderr += chunk.toString("utf-8")
				})
				child.on("close", (code) => {
					clearTimeout(timeout)
					resolve({ stdout, stderr, exitCode: code, timedOut })
				})
				child.on("error", (err) => {
					clearTimeout(timeout)
					resolve({ stdout, stderr: stderr + err.message, exitCode: -1, timedOut })
				})
			},
		)

		if (result.timedOut) {
			return formatResponse.toolError(
				`LLM Relay timed out after ${RELAY_TIMEOUT_MS / 1000}s. Try a different model (gpt4o is more reliable than gemini-pro for long prompts).`,
			)
		}
		if (result.exitCode !== 0) {
			return formatResponse.toolError(
				`LLM Relay exited with code ${result.exitCode}. stderr: ${result.stderr.slice(0, 2000)}`,
			)
		}

		// Strip common markdown fences from output (relay sometimes wraps code in ```)
		let output = result.stdout
		const fenceMatch = output.match(/^```[a-z]*\n([\s\S]*?)\n```\s*$/)
		if (fenceMatch) {
			output = fenceMatch[1]
		}

		if (outputFile) {
			try {
				await fs.mkdir(path.dirname(outputFile), { recursive: true })
				await fs.writeFile(outputFile, output, "utf-8")
				return formatResponse.toolResult(
					`LLM Relay (${model}) completed. Output written to ${outputFile} (${output.length} bytes). Use the Read tool to inspect it if needed.`,
				)
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				return formatResponse.toolError(`Failed to write output_file ${outputFile}: ${msg}`)
			}
		}

		return formatResponse.toolResult(output)
	}
}
