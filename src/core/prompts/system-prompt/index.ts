import { loadClaudeCodeContext } from "./claude-code-loader"
import { loadClineCodeMemoryIndex } from "./memory-loader"
import { PromptRegistry } from "./registry/PromptRegistry"
import type { SystemPromptContext } from "./types"

export { ClineToolSet } from "./registry/ClineToolSet"
export { PromptBuilder } from "./registry/PromptBuilder"
export { PromptRegistry } from "./registry/PromptRegistry"
export * from "./templates/placeholders"
export { TemplateEngine } from "./templates/TemplateEngine"
export * from "./types"
export { VariantBuilder } from "./variants/variant-builder"
export { validateVariant } from "./variants/variant-validator"

/**
 * Get the system prompt by id.
 *
 * Cline-CC fork additions, appended to the base prompt in this order:
 * 1. `~/CLAUDE.md` (Claude-Code-style project context)
 * 2. `~/.claude/projects/-Users-<user>/memory/MEMORY.md` (memory index)
 *
 * Each loader returns "" when its source is missing, so upstream behavior is
 * preserved on machines without Claude Code installed.
 */
export async function getSystemPrompt(context: SystemPromptContext) {
	const registry = PromptRegistry.getInstance()
	const [basePrompt, claudeCodeContext, memoryIndex] = await Promise.all([
		registry.get(context),
		loadClaudeCodeContext(),
		loadClineCodeMemoryIndex(),
	])
	const systemPrompt = basePrompt + claudeCodeContext + memoryIndex
	const tools = context.enableNativeToolCalls ? registry.nativeTools : undefined
	return { systemPrompt, tools }
}
