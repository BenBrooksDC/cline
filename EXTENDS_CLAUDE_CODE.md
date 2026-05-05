# Cline (Claude Code Edition) — Fork Divergence Notes

This is a fork of [cline/cline](https://github.com/cline/cline) maintained at
[BenBrooksDC/cline](https://github.com/BenBrooksDC/cline). Apache 2.0.
Not affiliated with Anthropic.

## Why the fork

Provides a multi-provider fallback for the Claude Code workflow when the upstream
Anthropic Max plan quota is exhausted. Preserves CLAUDE.md auto-loading, memory
auto-loading, the LLM Relay offload pattern, and adds cross-provider token
spend monitoring with budgets and drain alerts.

## Files added (additive — easy to merge upstream)

| Path | Purpose |
|---|---|
| `src/core/prompts/system-prompt/claude-code-loader.ts` | Reads `~/CLAUDE.md` at session start, resolves `@<path>` refs, caps at 32KB |
| `src/core/prompts/system-prompt/memory-loader.ts` | Reads `~/.claude/projects/-Users-<user>/memory/MEMORY.md` and injects the index |
| `src/core/prompts/system-prompt/tools/llm_relay.ts` | Tool spec for the `llm_relay` tool |
| `src/core/task/tools/handlers/LLMRelayToolHandler.ts` | Spawns `python3 ~/llm-connector/llm.py` |
| `src/core/usage/pricing.ts` | Provider × model price table |
| `src/core/usage/UsageTracker.ts` | Singleton, logs to `~/.claude/cline-cc-usage.jsonl`, tracks daily/monthly spend, fires drain alerts |
| `src/hosts/vscode/cline-cc-status-bar.ts` | VS Code status bar item with live spend display |

## Files modified (touched lines documented for upstream merges)

| Path | What changed |
|---|---|
| `package.json` | displayName, publisher, version `3.82.0-cc1` |
| `src/shared/tools.ts` | Added `LLM_RELAY = "llm_relay"` to `ClineDefaultTool` enum |
| `src/core/assistant-message/index.ts` | Added `model`, `prompt_file`, `output_file` to `toolParamNames` |
| `src/core/prompts/system-prompt/index.ts` | `getSystemPrompt` now appends CLAUDE.md and memory index |
| `src/core/prompts/system-prompt/tools/init.ts` | Imports + spreads `llm_relay_variants` |
| `src/core/prompts/system-prompt/variants/*/config.ts` (12 files) | Added `ClineDefaultTool.LLM_RELAY` to each variant's `.tools()` list |
| `src/core/task/tools/ToolExecutorCoordinator.ts` | Imports + registers `LLMRelayToolHandler` |
| `src/core/task/index.ts` | `onUsageChunk` callback now calls `UsageTracker.get().record(...)` |
| `src/extension.ts` | Imports + calls `registerUsageStatusBar(context)` in `activate()` |

## Files reused unchanged

- `~/CLAUDE.md` — read by `claude-code-loader.ts` as-is.
- `~/.claude/projects/-Users-<user>/memory/*.md` — read by `memory-loader.ts`.
- `~/llm-connector/llm.py` — invoked by `LLMRelayToolHandler.ts`.
- `~/.claude/conservation_mode`, `~/bin/conserve`, `~/.claude/conserve_ui.swift` — keep working as-is for the Claude Code side.

## Phase E (deferred)

The conservation hook bridge — auto-injecting `~/.claude/hooks/conservation_context.py`
output into Cline's UserPromptSubmit hook — is NOT yet implemented. When a fresh
session is started and conservation mode is on, the auto-loaded CLAUDE.md still
documents the conservation rules so the agent will follow them, but the per-turn
state injection currently only runs in Claude Code, not in this fork. To add it:

1. Create `~/Documents/Cline/Hooks/UserPromptSubmit` (executable bash/python script).
2. The script reads Cline's `HookInput` JSON from stdin, extracts `userPromptSubmit.prompt`.
3. Pipe the prompt into `~/.claude/hooks/conservation_context.py` (which expects `{"prompt": "..."}` on stdin).
4. Read its output (`{"hookSpecificOutput": {"additionalContext": "..."}}`).
5. Output Cline's format to stdout: `{"contextModification": "<additionalContext>"}`.

## Upstream sync workflow

```bash
git fetch upstream
git merge upstream/main
# Resolve conflicts (most are in init.ts and ToolExecutorCoordinator.ts where new tools land)
npm install
npm run package
npx --yes @vscode/vsce package -o cline-cc.vsix
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension cline-cc.vsix
```
