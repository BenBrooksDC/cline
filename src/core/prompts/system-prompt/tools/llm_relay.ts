import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.LLM_RELAY,
	name: "llm_relay",
	description: `Delegates a task to an external LLM via the user's local relay CLI (\`python3 ~/llm-connector/llm.py\`). Use this when you need to offload heavy generation work to a different model so you preserve the conversation context and the user's Anthropic quota.

Use this tool for:
- Code generation longer than ~80 lines
- Bulk data, fixtures, mock objects (use cheap models)
- Format conversion (CSV→JSON, restructuring large datasets)
- Doc/log summarization
- Code review of long diffs
- Generating large test suites
- Generating regex/SQL/syntax-heavy snippets

Do NOT use this tool for:
- Architecture or design decisions (those are your job)
- Security-critical logic
- Active debugging where you have the full code context
- Trivial work you can do faster yourself

Model selection (passed in the \`model\` parameter):
- \`gpt4o\` — recommended default for non-trivial code generation. Most reliable.
- \`gemini-pro\` — strong reasoning and code, cheaper than gpt4o. Good for code.
- \`gemini-flash\` — fast, cheap. Use for review or summarization, not code.
- \`gemini-flash-lite\` — cheapest. Bulk data and fixtures only. NEVER for non-trivial code.
- \`gpt4o-mini\` — cheap. Trivial regex/SQL only. NEVER for non-trivial code (ships with multi-bug output).
- \`gemini3-pro\` — newest, strongest reasoning. Use for hard architecture review.
- \`grok3\` / \`grok3-mini\` — alternatives if you want a non-Google/OpenAI second opinion.

Workflow:
1. Use the Write tool to create a markdown spec file at \`/tmp/relay_<task>.md\` describing exactly what you want generated. Be precise — include file paths, function signatures, imports, style requirements.
2. Call this tool with that spec file path.
3. Optionally provide \`output_file\` to have the relay write the result directly to a file path you specify, bypassing the conversation. Strongly recommended for output >100 lines.
4. The tool returns the relay's text output (or, with \`output_file\`, just a confirmation pointer).

The CLI reads the API keys from \`~/.zshrc\` (OpenAI, Google, xAI). Budget caps and usage tracking are handled by the relay itself.`,
	contextRequirements: () => true,
	parameters: [
		{
			name: "model",
			required: true,
			instruction:
				"Relay model alias. Use 'gpt4o' or 'gemini-pro' for non-trivial code; 'gemini-flash-lite' for bulk data; 'gemini-flash' for review/summarization. Never use 'gpt4o-mini' or 'gemini-flash-lite' for code.",
			usage: "gpt4o",
		},
		{
			name: "prompt_file",
			required: true,
			instruction:
				"Absolute path to a markdown spec file containing the prompt. Use the Write tool to create the spec first, then pass its path here.",
			usage: "/tmp/relay_my_task.md",
		},
		{
			name: "output_file",
			required: false,
			instruction:
				"Optional. If provided, the relay's output will be written directly to this absolute file path instead of returned in the tool response. Strongly recommended for outputs >100 lines.",
			usage: "/Users/me/project/src/generated.ts",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id: ClineDefaultTool.LLM_RELAY,
	name: "llm_relay",
	description:
		"Delegates a task to an external LLM via the user's local relay CLI (python3 ~/llm-connector/llm.py). Use for code generation >80 lines, bulk data, format conversion, or summarization. Provide a markdown spec file path; optionally provide output_file to bypass the conversation for large outputs. Use 'gpt4o' or 'gemini-pro' for code; cheap models only for non-code bulk work.",
	contextRequirements: () => true,
	parameters: [
		{
			name: "model",
			required: true,
			instruction:
				"Relay model alias: 'gpt4o', 'gemini-pro', 'gemini-flash', 'gemini-flash-lite', 'gpt4o-mini', 'gemini3-pro', 'grok3', 'grok3-mini'. Use 'gpt4o' or 'gemini-pro' for non-trivial code.",
		},
		{
			name: "prompt_file",
			required: true,
			instruction: "Absolute path to a markdown spec file containing the prompt. Create with the Write tool first.",
		},
		{
			name: "output_file",
			required: false,
			instruction:
				"Optional absolute path. If provided, the relay's output is written there instead of returned. Use for outputs >100 lines.",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const llm_relay_variants = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN]
