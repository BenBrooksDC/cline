import type { ApiProviderInfo } from "@/core/api"
import { getDeepPlanningPrompt } from "./commands/deep-planning"

/**
 * LuciBuild fork: /review-pr slash command. Review someone else's PR
 * (or your own) like a senior reviewer would.
 */
export const reviewPrToolResponse = () =>
	`<explicit_instructions type="review-pr">
The user wants you to review a pull request. The PR may be specified by URL, number, or just "this branch".

Workflow:
1. Identify the PR target:
   - URL pattern: parse owner/repo + PR number
   - "#123" or "PR 123": resolve via gh CLI in current repo
   - "this branch" / no arg: review the local diff against the base branch
2. Fetch the diff: \`gh pr diff <number>\` or \`gh api repos/<o>/<r>/pulls/<n>/files\` — handle large PRs by paginating.
3. Read the PR description (gh pr view <n>) for stated intent.
4. Read the diff. For each changed file, evaluate:
   - **Does the change match stated intent?** (description says X, diff does Y?)
   - **Correctness:** edge cases, null handling, race conditions
   - **Security:** secrets, injection, auth bypass
   - **Performance:** O(n²), unnecessary re-renders, sync I/O on hot paths
   - **Style fit:** matches existing codebase conventions
   - **Test coverage:** new code without new tests?
   - **Backward compatibility:** breaking changes flagged in description?
   - **Documentation:** API changes without docs?
5. **Output:** structured review with file:line — finding — suggested action. Group by severity (must-fix / should-fix / nit). End with a one-line verdict: approve / request-changes / comment.
6. Offer to post the review as inline comments via gh pr review (with explicit user approval before posting).

Be honest. Don't invent issues to seem thorough. If the PR is good, say "looks good — approve".

Below is the user's PR review request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /privacy slash command. Toggle privacy mode (all-local-only).
 */
export const privacyToolResponse = () =>
	`<explicit_instructions type="privacy">
The user wants to toggle privacy mode. When ON, this fork should refuse to call any remote API (no web_fetch, no web_search, no llm_relay against hosted models, no remote inference).

Workflow:
1. Read current state by inspecting \`~/.claude/lucibuild-costly-features.json\` for the \`privacy-mode\` entry. If absent or \`enabled: false\`, treat as OFF.
2. Confirm intent with ask_followup_question:
   - If currently OFF: "Enable privacy mode? Many features (web_fetch, web_search, hosted-model inference) will become unavailable. Local-only Ollama models continue to work."
   - If currently ON: "Disable privacy mode? Hosted-model and web-tool calls will be allowed again."
3. On approval, write to \`~/.claude/lucibuild-costly-features.json\` updating the \`privacy-mode\` entry.
4. Confirm to the user. If turning ON for the first time, also explicitly note: "Restart any active Cline-CC chats to pick up the new restriction."

Hard rule: NEVER toggle privacy mode without explicit user confirmation in this turn. NEVER infer it from a question — only from a clear toggle request.

Below is the user's privacy request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /onboard slash command. First-run repo onboarding wizard.
 */
export const onboardToolResponse = () =>
	`<explicit_instructions type="onboard">
The user wants a "first day on the job" tour of the current codebase. Produce a structured onboarding brief.

Workflow:
1. **Survey:** use list_files (recursive) on the workspace root, list_code_definition_names on key directories, read README.md / CONTRIBUTING.md / package.json / pyproject.toml / Cargo.toml / go.mod.
2. **Output a structured brief** with these sections:
   - **What this project does** (1-paragraph plain-language summary)
   - **Stack** (languages, frameworks, key deps)
   - **Layout** (top-level dirs with one-line purpose each — skip node_modules/dist/etc.)
   - **Entry points** (main scripts, server bootstrap files, CLI entry, etc.)
   - **Key abstractions** (3-7 most important classes/modules an onboarder should learn first)
   - **How to run it locally** (install + dev command, inferred from package.json / Makefile / README)
   - **Where the tests live** + how to run them
   - **Recent activity** (git log --oneline -20 to surface what's hot right now)
   - **Conventions worth knowing** (any non-obvious style decisions visible in the code)
   - **Things that look like tech debt** (TODOs, suspicious patterns) — brief, not exhaustive (use /debt for full)
3. Save to \`docs/ONBOARDING.md\` (or update if exists). Print the path.
4. Optionally propose a memory entry under type 'project' summarizing the project's purpose so future LuciBuild sessions in this dir know what they're working on.

Keep it readable: aim for one printed page, not ten.

Below is the user's onboard request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /a11y slash command. Accessibility + i18n audit.
 */
export const a11yToolResponse = () =>
	`<explicit_instructions type="a11y">
Audit the workspace for accessibility (a11y) and internationalization (i18n) issues.

Workflow:
1. Detect frontend type: React (.tsx/.jsx), Vue, Svelte, plain HTML.
2. Scan for common issues:
   - Missing alt text on <img>
   - Buttons / links without accessible names
   - Color contrast inferred from style/CSS files
   - Missing label-for / aria-label on form inputs
   - <div onClick> instead of <button> (keyboard inaccessible)
   - Missing role / aria attributes on custom components
   - Hardcoded English strings outside an i18n catalog (suggest extraction)
   - Missing lang attribute on <html>
3. Output a prioritized list (must-fix / should-fix / nit) with file:line and suggested fix.
4. Offer to apply fixes for the must-fix tier automatically; ask for the rest.

Skip backend-only repos with no UI.

Below is the user's a11y request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /debt slash command. Tech-debt tracker.
 */
export const debtToolResponse = () =>
	`<explicit_instructions type="debt">
Scan the workspace for tech-debt indicators and produce a prioritized list.

Sources to check:
  - TODO / FIXME / XXX / HACK comments
  - Functions over 100 lines
  - Files over 800 lines
  - Cyclomatic complexity hot spots (look for deeply nested if/else, switch with many cases)
  - Duplicate code blocks (use grep / search_files for similar function bodies)
  - Dead code (functions with no callers — use grep on identifiers)
  - Outdated deps (compare package.json to npm view <pkg> latest)
  - Missing tests for public APIs
  - Commented-out code blocks

Output format: priority-scored markdown table (P0 critical / P1 high / P2 nice-to-have) with file:line, type, description, suggested action. Save to \`~/.lucibuild/debt-<workspace-hash>.json\` so it persists across sessions and you can show diffs over time.

Below is the user's debt-tracker request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /perf slash command. Performance profiler integration.
 */
export const perfToolResponse = () =>
	`<explicit_instructions type="perf">
Profile the project's performance and propose optimizations.

Workflow:
1. Detect language/runtime and pick a profiler:
   - Node.js: \`clinic.js\` doctor / flame / bubbleprof, or built-in \`node --prof\`
   - Python: \`pyinstrument\` (preferred), \`cProfile\`, or \`py-spy\`
   - Rust: \`cargo flamegraph\`
   - Go: built-in pprof
   - Generic CLI: \`hyperfine\` for benchmarking
2. Ask the user what to profile (a script, an HTTP request flow, a hot function). If unclear, propose the test-suite as a default.
3. Install the profiler if missing (use the dry-run install gate from /install).
4. Run the profile, capture the output.
5. Identify the top N hotspots by cumulative time. For each, propose an optimization with code-level specificity (algorithm change, caching, batching, async I/O, etc.).
6. Offer to apply the top 1-3 fixes; defer the rest unless asked.

Below is the user's perf request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /secret-rotate slash command. Detects hardcoded secrets,
 * proposes .env migration, generates .env.example.
 */
export const secretRotateToolResponse = () =>
	`<explicit_instructions type="secret-rotate">
Find hardcoded secrets in the workspace and propose a migration to environment variables.

Workflow:
1. Scan source files for: API keys, OAuth tokens, JWT secrets, DB connection strings with passwords, Stripe keys (sk_*), AWS credentials, GitHub tokens (ghp_*, gho_*, ghs_*), private keys, base64-encoded secrets >32 chars.
2. For each finding:
   - File:line
   - Type of secret (high-confidence guess)
   - Severity (production-key vs test/dev key heuristic)
3. Propose an .env migration:
   - Generate / update \`.env\` with the values (NEVER commit this — verify .gitignore)
   - Generate / update \`.env.example\` with placeholder values
   - Update source code to read from process.env / os.environ
   - Add the load step (dotenv, python-dotenv, etc.) if not already present
4. CRITICAL: also remind the user to ROTATE the leaked secrets in their respective dashboards. Hardcoded = leaked = must be rotated regardless of whether code is public.
5. Don't auto-commit changes; let the user verify.

Below is the user's secret-rotate request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /snippet slash command. Reusable snippet library.
 */
export const snippetToolResponse = () =>
	`<explicit_instructions type="snippet">
Manage reusable code snippets stored at \`~/.claude/lucibuild-snippets/\`.

If the user's message starts with "save" or "create": save mode.
  1. Identify the recent code that should become a snippet.
  2. Ask for a short name (kebab-case, e.g. "auth-middleware").
  3. write_to_file at \`~/.claude/lucibuild-snippets/<name>.<ext>\` with a 2-line header comment describing what it does.
  4. Confirm.

If the user's message starts with "use", "insert", or just a snippet name: retrieve mode.
  1. List matches if name is fuzzy.
  2. read_file the snippet.
  3. Insert into the active editor at the cursor (or paste into a new file the user opens).

If just \`/snippet\`: list all snippets in the directory with their first-line descriptions.

Below is the user's snippet request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /migrate slash command. Multi-file automated migrations
 * for known transformations.
 */
export const migrateToolResponse = () =>
	`<explicit_instructions type="migrate">
The user wants you to perform a known multi-file migration. Common migration types:
  - JS class components → React hooks
  - JavaScript → TypeScript (with type inference)
  - CommonJS (require/module.exports) → ESM (import/export)
  - Mocha → Vitest (or Jest → Vitest)
  - callbacks → async/await
  - moment.js → date-fns or dayjs
  - axios → fetch
  - Express → Fastify
  - Python 2 → Python 3
  - sync I/O → async I/O

Workflow:
1. Identify the migration type from the user's request. If ambiguous, ask one clarifying question with concrete options.
2. Scope the work: list every file that will change. Use search_files / list_files to enumerate. Show the count.
3. Get explicit approval ("Proceed with migration of N files?") via ask_followup_question with ["Proceed", "Show one file as preview first", "Cancel"].
4. If "preview first": pick a representative file, show before/after diff, get OK before proceeding to the full set.
5. Execute file-by-file. Use replace_in_file for surgical changes; use write_to_file only when refactor scope is large enough that diffs would be unreadable.
6. After every ~5 files, run the project's typecheck/test command to catch regressions early; if anything fails, STOP and report.
7. At the end: summary of files changed, any tests that newly fail, suggested manual follow-ups.

Hard rules:
- NEVER migrate code under test/ without also adapting tests.
- NEVER drop existing functionality silently.
- If a file has a particularly unusual pattern, surface it for human review instead of guessing.

Below is the user's migration request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /diagram slash command. Generates Mermaid/PlantUML
 * architecture diagrams from the current workspace.
 */
export const diagramToolResponse = () =>
	`<explicit_instructions type="diagram">
Generate an architecture diagram from the current workspace.

Workflow:
1. Ask which diagram type (or infer from the request):
   - System-context (services + external dependencies)
   - Module-graph (which files import which)
   - Class diagram (for OOP code)
   - Sequence (for a specific flow the user names)
   - Database ER (if SQL/Prisma/drizzle schemas exist)
2. Use list_files + read_file to read enough of the codebase to populate the diagram. Don't read everything — sample strategically.
3. Output: Mermaid syntax (preferred) or PlantUML if the user specified. Wrap in a code fence so VS Code can render it.
4. Save to \`docs/diagrams/<type>-<date>.md\` using write_to_file. Offer to update an existing file if one exists.
5. End with one paragraph explaining the diagram's key relationships.

Don't over-detail. A diagram with 100 nodes is unreadable; aim for ≤25 nodes per diagram. If the system is bigger, propose a layered set (high-level + drill-downs).

Below is the user's diagram request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /persona slash command. Switches the agent's persona for the
 * remainder of the task. Personas tune the voice + risk tolerance + review depth.
 */
export const personaToolResponse = () =>
	`<explicit_instructions type="persona">
Switch your operating persona for the rest of this task. Available personas:

  **senior-backend** — emphasize correctness, edge cases, error handling, observability. Prefer explicit over magical. Skeptical of dependencies.
  **senior-frontend** — emphasize accessibility, perf, semantic HTML, prop API design. Skeptical of premature state.
  **security-reviewer** — read code looking for footguns. Default to "what could a malicious input do here?". Don't be productive about new features; focus on hardening.
  **junior-mentor** — explain reasoning at every step. Show the small example before the abstraction. Pair-programming voice.
  **qa-skeptic** — for every claim of "this works", ask "what's the edge case that breaks it?". Push for test coverage.
  **shipping-pm** — bias toward shipping fast. Cut scope. Ask "what's the smallest version that solves the user's actual problem?".
  **architect** — zoom out. Identify the system-design tradeoff before diving into implementation. Skeptical of feature work that compounds tech debt.

Apply the chosen persona for the rest of this task only (revert at task end). State which persona you've adopted in your first response, then operate accordingly.

Below is the user's persona-switch request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /pre-commit-review slash command. Reads the user's local
 * uncommitted diff and gives senior-engineer feedback BEFORE they push.
 * Different from /review-pr (which reviews someone else's PR).
 */
export const preCommitReviewToolResponse = () =>
	`<explicit_instructions type="pre-commit-review">
Act as a senior code reviewer for the user's uncommitted local changes. Goal: catch issues before the commit/push, not after.

Workflow:
1. Run \`git diff --staged\` first; if empty, run \`git diff\` (unstaged). Combine if both have content.
2. Read the diff. For each meaningful change, evaluate:
   - **Correctness:** does the code do what its surrounding context implies?
   - **Edge cases:** off-by-one, null/undefined, empty array, race conditions, error paths
   - **Security:** secrets in diff, SQL injection, unsanitized input
   - **Performance:** O(n²) where O(n) works, unnecessary re-renders, sync I/O on hot paths
   - **Style fit:** matches the codebase conventions (compare to nearby existing code)
   - **Test coverage:** does this need a test? Does the diff touch a tested module without updating tests?
   - **Documentation:** is a public API changing without docs?
3. **Output format:** group feedback by severity (must-fix / should-fix / nit). For each item: file:line — finding — suggested change. Be specific, not generic.
4. After review, ask: "Want me to apply any of these as patches?" If yes, use replace_in_file. Otherwise stop.

Be honest. If the diff looks good, say "looks good — ship it" and stop. Don't invent issues to seem thorough.

Below is the user's pre-commit review request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /tdd slash command. Strict spec-to-code TDD workflow.
 */
export const tddToolResponse = () =>
	`<explicit_instructions type="tdd">
The user wants strict TDD: spec → failing test → minimum code to pass → refactor.

Workflow (do NOT skip steps):
1. **Read the spec** the user provided. If it's vague, ask ONE clarifying question max. Otherwise proceed.
2. **Detect the test framework** in the workspace (Jest, Vitest, pytest, mocha, RSpec, cargo test, go test). Use the existing one; don't introduce a new one.
3. **Write a failing test** that captures the spec's main expectation. Use write_to_file in the project's test directory. Filename matches the convention (e.g., \`<module>.test.ts\` or \`test_<module>.py\`).
4. **Run the test.** Use execute_command with the project's test runner. Confirm it FAILS for the right reason (the test framework reports the assertion failure, not a syntax error in the test).
5. **Write minimum code to pass.** Touch only what's needed. No premature abstraction.
6. **Run the test again.** Confirm it PASSES.
7. **Refactor (only if there's clear duplication or smell).** Keep tests green.
8. **Repeat for the next spec increment** if the user gave multiple expectations. Otherwise call attempt_completion.

Hard rules:
- NEVER write production code without a failing test first.
- NEVER claim "tests pass" without showing the actual test runner output.
- NEVER skip step 4 (failing-for-the-right-reason). A test that fails because of a typo doesn't count.

Below is the user's TDD request (their spec):
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /audit slash command. Runs a dependency security audit on the
 * current project (npm audit / pip-audit / cargo audit / etc.) and surfaces
 * vulnerabilities + suggested patches.
 */
export const auditToolResponse = () =>
	`<explicit_instructions type="audit">
Run a dependency security audit for the current workspace.

Workflow:
1. Detect the package ecosystem(s) in the workspace: package.json (npm), requirements.txt / pyproject.toml (pip), Cargo.toml (cargo), Gemfile (bundler), go.mod (go).
2. For each detected ecosystem, run the appropriate free audit command:
   - npm: \`npm audit --json\`
   - pip: \`pip-audit --format json\` (offer to install pip-audit if missing)
   - cargo: \`cargo audit --json\`
   - bundler: \`bundle audit\`
   - go: \`govulncheck ./...\`
3. Parse results. For each vulnerability:
   - Severity (critical / high / moderate / low)
   - Affected package + version
   - CVE / advisory ID
   - Suggested fix (upgrade to version X)
4. Output a prioritized table sorted by severity. Highlight any CRITICAL or HIGH issues that have a known patch.
5. Offer to apply non-breaking fixes automatically (only patch/minor version bumps); ask before applying any major version bumps.
6. Skip LLM-based vulnerability summaries — the free audit tools' output is sufficient.

If no package manifests are found, say so and stop.

Below is the user's audit request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /export-chat slash command. Exports the current conversation
 * as a self-contained markdown playbook the user can share or replay later.
 */
export const exportChatToolResponse = () =>
	`<explicit_instructions type="export-chat">
Export the current conversation as a self-contained markdown "playbook" the user can share or replay.

Workflow:
1. Ask the user for a title (or propose one based on the task), output filename (default: \`~/lucibuild-playbooks/<slug>.md\`), and audience ("self" / "teammate" / "public").
2. Synthesize the conversation into a clean playbook markdown with these sections:
   - **Title**
   - **One-paragraph summary** of the goal achieved
   - **Prerequisites** (tools installed, env vars, repo state)
   - **Step-by-step actions taken** (with the exact commands, file paths, key decisions)
   - **Outcome** (what changed, what to expect when running it)
   - **Caveats / things-to-check** (failure modes, manual steps that didn't get automated)
3. STRIP secrets: scan for API keys, tokens, passwords, hostnames-with-credentials, .env values. Replace with \`<REDACTED>\` placeholders. NEVER include even partial keys.
4. STRIP user-private context unless audience == "self": ~/CLAUDE.md content, ~/.claude/projects/.../memory/* references, ~/.zshrc paths.
5. Use write_to_file to save it. Print the path so the user can share it.

Below is the user's export request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /template slash command. Saves a successful workflow as a reusable template OR runs a saved template.
 */
export const templateToolResponse = () =>
	`<explicit_instructions type="template">
Manage reusable workflow templates.

Templates live at \`~/.claude/lucibuild-templates/<name>.md\` as plain markdown describing the workflow steps.

If the user's message starts with "save" or "create": treat it as save mode.
  1. Synthesize the recent conversation into a step-by-step template.
  2. Use write_to_file to save at the right path.
  3. Confirm success with the saved name.

If the user's message starts with "run", "use", or just a template name: treat it as run mode.
  1. Read the template file.
  2. Execute its steps in order, using ask_followup_question between each major step if the template has parameters.

If the user just types \`/template\` with no description: list existing templates from the templates directory.

Below is the user's template request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /bootstrap slash command. Scaffolds a complete starter project
 * matching a natural-language description. Aligned with the LuciBuild platform's
 * "submit-an-idea-we-build-it" mission.
 */
export const bootstrapToolResponse = () =>
	`<explicit_instructions type="bootstrap">
The user wants you to scaffold a brand-new project from a natural-language description. Your job: produce a working starter project the user can run within minutes.

Workflow you MUST follow:

1. **Parse the description.** Extract: project type (web app, API, CLI, mobile, library, etc.), language/framework preference (if any), key features mentioned, target deployment if mentioned.

2. **Propose a stack.** Output a concise stack proposal:
   - Language + framework (e.g., "TypeScript + Vite + React" or "Python + FastAPI")
   - Database (only if needed; default to none for MVPs)
   - Test framework
   - Key dependencies
   - Project layout (top-level dirs)
   - Default port / dev script
   The proposal should default to LIGHT, modern, popular choices unless the user specified otherwise. Don't over-engineer.

3. **Get approval.** Use ask_followup_question with options like ["Bootstrap with this stack", "Change something", "Cancel"]. Do not start scaffolding without explicit approval.

4. **Pick a target directory.** Use the current workspace if appropriate; otherwise create a new dir as specified. Default name: kebab-case of the description's nouns (e.g., "recipe-tracker-app").

5. **Scaffold:**
   a. Initialize: \`npm init -y\` / \`uv init\` / \`cargo init\` etc. (whichever fits the stack).
   b. Install deps: minimal set, pinned to recent stable versions. Use the LLM Relay (gpt4o or gemini-pro) to generate the package.json content if needed.
   c. Create directory layout (use list_files to verify).
   d. Write starter files:
      - Entry point (index.ts / main.py / App.tsx / etc.) with a working "hello world" + one example feature.
      - README.md with: one-paragraph description, prereqs, "how to run", "project layout", "next steps".
      - .gitignore appropriate for the stack.
      - Optional: Dockerfile if user mentioned deployment, .env.example if env vars are needed.
   e. Run \`git init\`, stage, make initial commit titled "Initial scaffold by LuciBuild".

6. **Verify.** Run the dev script (\`npm run dev\` or equivalent) — confirm it starts without errors. Take a screenshot if it's a web app and the browser-tools MCP is installed; otherwise just report the URL.

7. **Hand off.** Print a clear summary:
   - Working directory absolute path
   - How to run dev server
   - Where to put new code
   - Next 3 suggested steps (e.g., "add a /health endpoint", "wire up a database", "write your first test")
   - Optionally propose a memory entry under type 'project' with the project's purpose + stack so future LuciBuild sessions in this dir know what they're working on.

Hard rules:
- NEVER scaffold inside ~/Desktop, ~/Documents, ~/Downloads, or ~ itself unless the user explicitly approved (the checkpoint allowlist guards against this for git, but the user might still ask).
- NEVER overwrite a non-empty directory without explicit approval.
- NEVER add proprietary or paid services (Stripe, Auth0, etc.) by default — only if the user asked for them.
- KEEP the dependency list LIGHT. A scaffold with 200 deps is a failure. Aim for under 30 direct deps for a typical web/API project.

Below is the user's bootstrap request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /install slash command. Lets the user ask for a new tool by
 * description; agent maps it to a concrete package + install command, surfaces
 * a dry-run preview, and (after approval) installs and registers it.
 */
export const installToolResponse = () =>
	`<explicit_instructions type="install">
The user wants you to source, install, and configure a new tool that extends your capabilities. This may be:
  - A CLI tool (installed via brew, apt, npm -g, pip, cargo, gem, go install, etc.)
  - A library / package within the current workspace (npm install, pip install -r, etc.)
  - An MCP server (installed via npx and registered with Cline's MCP config)
  - A new VS Code extension (let the user know they need to install it themselves; you can't)

Workflow you MUST follow:

1. **Understand the request.** Parse the user's description. If ambiguous, ask ONE clarifying question (what platform? local tool or MCP server? specific package preferred?).

2. **Identify the canonical package.** Use your knowledge + the LuciBuild MCP registry at \`src/core/tools/mcp-registry.json\` (when matching MCP servers) + 'npm view <pkg>' / 'pip show <pkg>' / 'brew info <pkg>' to verify the package exists and is the right one. Prefer official / first-party packages from known publishers.

3. **Surface a dry-run preview.** Before executing, output a structured summary:
   - Package name + version + publisher
   - Install command verbatim
   - What it adds (binary on PATH, library import, MCP tool surface, etc.)
   - Estimated download size if available
   - Anything destructive it might do (almost never, but flag if a postinstall script touches global state)

4. **Get explicit approval.** Use ask_followup_question with options like ["Install", "Cancel", "Choose different package"]. Do NOT proceed without an explicit "Install" answer.

5. **Execute the install.** Use execute_command. Capture stderr/stdout. Verify success with a smoke check (which <cmd>, npm view <pkg>, etc.).

6. **Register if needed.**
   - For MCP servers: update Cline's MCP config (use the use_mcp_tool / load_mcp_documentation tools or write to the MCP settings file directly).
   - For CLI tools: just confirm 'which <cmd>' returns a path.
   - For libraries: confirm the package appears in package.json / requirements.txt / Pipfile.

7. **Propose a recipe memory.** After successful install, suggest saving an entry under ~/.claude/projects/-Users-<user>/memory/ as type 'reference' so future sessions remember the install command and any usage notes (filename: reference_<tool>_install.md).

Hard rules:
- NEVER skip the dry-run preview, even if the user seems impatient.
- NEVER install something with sudo without explicit approval naming "sudo".
- NEVER run install commands that touch shell config files (e.g., adding to ~/.zshrc) without explicit approval.
- If install fails, surface the exact error; do NOT silently retry with a different package.

Below is the user's installation request:
</explicit_instructions>\n
`

/**
 * LuciBuild fork: /remember slash command. Mirrors Claude Code's auto-memory:
 * agent scans the current conversation, proposes memory entries for non-obvious
 * facts (user prefs, project state, reference links, feedback), and writes them
 * via write_to_file to the user's memory directory.
 */
export const rememberToolResponse = () =>
	`<explicit_instructions type="remember">
The user wants you to extract durable information from this conversation and save it to their long-term memory system at \`~/.claude/projects/-Users-<username>/memory/\` (you can derive <username> from \`os.homedir()\` basename).

The memory system has 4 types of entries:
1. **user** — about the user's role, goals, knowledge, preferences (e.g., expertise areas, projects they own)
2. **feedback** — guidance on how to approach work (corrections, validated approaches, hard rules with reasons)
3. **project** — ongoing initiatives, goals, decisions, deadlines, project state (with WHY)
4. **reference** — pointers to where information lives in external systems (Linear, GitHub, dashboards)

DO NOT save:
- Code patterns or architecture (derivable from the codebase)
- Recent git changes (in git log)
- Debugging fix recipes (the fix is in the code)
- Anything already in CLAUDE.md
- Ephemeral conversation state

Workflow you must follow:
1. Identify 0–5 candidate memories from THIS conversation. Quality > quantity. If nothing is genuinely worth saving, say so and stop.
2. For each candidate, propose:
   - File name following the pattern \`<type>_<short_name>.md\` (e.g. \`feedback_terse_replies.md\`, \`project_lucibuild_pricing.md\`)
   - Frontmatter:
     \`\`\`
     ---
     name: <short title>
     description: <one-line hook used to decide relevance in future conversations>
     type: <user|feedback|project|reference>
     ---
     \`\`\`
   - Body: the rule/fact, with **Why:** and **How to apply:** lines for feedback/project types.
3. Present all candidates to the user as a numbered list with proposed file paths. Ask which to save (e.g., "1, 3" or "all" or "none").
4. After confirmation, use write_to_file for each approved candidate, then update \`~/.claude/projects/-Users-<username>/memory/MEMORY.md\` by appending a single-line index entry: \`- [<filename>](<filename>) — <one-line hook>\`.

Be honest if there is nothing surprising or non-obvious to save — saying "nothing worth committing to memory from this thread" is a valid outcome.

Below is the user's most recent message (likely empty or a clarification):
</explicit_instructions>\n
`

export const newTaskToolResponse = (willUseNativeTools: boolean) => {
	const xmlExample = `
Example:
<new_task>
<context>1. Current Work:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]

3. Relevant Files and Code:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Summary of the changes made to this file, if any]
      - [Important Code Snippet]
   - [File Name 2]
      - [Important Code Snippet]
   - [...]

4. Problem Solving:
   [Detailed description]

5. Pending Tasks and Next Steps:
   - [Task 1 details & next steps]
   - [Task 2 details & next steps]
   - [...]</context>
</new_task>
`

	return `<explicit_instructions type="new_task">
The user has explicitly asked you to help them create a new task with preloaded context, which you will generate. The user may have provided instructions or additional information for you to consider when summarizing existing work and creating the context for the new task.
Irrespective of whether additional information or instructions are given, you are ONLY allowed to respond to this message by calling the new_task tool.${willUseNativeTools ? " You MUST call the new_task tool EVEN if it's not in your existing toolset." : ""}

The new_task tool is defined below:

Description:
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions. This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the new task.
The user will be presented with a preview of your generated context and can choose to create a new task or keep chatting in the current conversation.

Parameters:
- Context: (required) The context to preload the new task with. If applicable based on the current task, this should include:
  1. Current Work: Describe in detail what was being worked on prior to this request to create a new task. Pay special attention to the more recent messages / conversation.
  2. Key Technical Concepts: List all important technical concepts, technologies, coding conventions, and frameworks discussed, which might be relevant for the new task.
  3. Relevant Files and Code: If applicable, enumerate specific files and code sections examined, modified, or created for the task continuation. Pay special attention to the most recent messages and changes.
  4. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
  5. Pending Tasks and Next Steps: Outline all pending tasks that you have explicitly been asked to work on, as well as list the next steps you will take for all outstanding work, if applicable. Include code snippets where they add clarity. For any next steps, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no information loss in context between tasks.
${xmlExample}
Below is the the user's input when they indicated that they wanted to create a new task.
</explicit_instructions>\n
`
}

export const condenseToolResponse = (focusChainSettings?: { enabled: boolean }) =>
	`<explicit_instructions type="condense">
The user has explicitly asked you to create a detailed summary of the conversation so far, which will be used to compact the current context window while retaining key information. The user may have provided instructions or additional information for you to consider when summarizing the conversation.
Irrespective of whether additional information or instructions are given, you are only allowed to respond to this message by calling the condense tool.

The condense tool is defined below:

Description:
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions. This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the conversation and supporting any continuing tasks.
The user will be presented with a preview of your generated summary and can choose to use it to compact their context window or keep chatting in the current conversation.
Users may refer to this tool as 'smol' or 'compact' as well. You should consider these to be equivalent to 'condense' when used in a similar context.

Parameters:
- Context: (required) The context to continue the conversation with. If applicable based on the current task, this should include:
  1. Previous Conversation: High level details about what was discussed throughout the entire conversation with the user. This should be written to allow someone to be able to follow the general overarching conversation flow.
  2. Current Work: Describe in detail what was being worked on prior to this request to compact the context window. Pay special attention to the more recent messages / conversation.
  3. Key Technical Concepts: List all important technical concepts, technologies, coding conventions, and frameworks discussed, which might be relevant for continuing with this work.
  4. Relevant Files and Code: If applicable, enumerate specific files and code sections examined, modified, or created for the task continuation. Pay special attention to the most recent messages and changes.
  5. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
  6. Pending Tasks and Next Steps: Outline all pending tasks that you have explicitly been asked to work on, as well as list the next steps you will take for all outstanding work, if applicable. Include code snippets where they add clarity. For any next steps, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no information loss in context between tasks.
${
	focusChainSettings?.enabled
		? `- task_progress: (required) The current state of the task_progress list, with completed items marked. Important information on this parameter is as follows:
  1. XML schema matches that of prior task_progress lists.
  2. All items are retained, with the exact same desciptive content as in prior occurences.
  3. All completed items are marked as completed.
  4. The only compenent of this list that can be changed is the completion state of invidiual items in the list`
		: ""
}

Usage:
<condense>
<context>Your detailed summary</context>
${focusChainSettings?.enabled ? `<task_progress>task_progress list here</task_progress>` : ""}
</condense>

Example:
<condense>
<context>
1. Previous Conversation:
  [Detailed description]

2. Current Work:
  [Detailed description]

3. Key Technical Concepts:
  - [Concept 1]
  - [Concept 2]
  - [...]

4. Relevant Files and Code:
  - [File Name 1]
    - [Summary of why this file is important]
    - [Summary of the changes made to this file, if any]
    - [Important Code Snippet]
  - [File Name 2]
    - [Important Code Snippet]
  - [...]

5. Problem Solving:
  [Detailed description]

6. Pending Tasks and Next Steps:
  - [Task 1 details & next steps]
  - [Task 2 details & next steps]
  - [...]
</context>
${
	focusChainSettings?.enabled
		? `<task_progress>
- [x] Set up project structure
- [x] Install dependencies
- [ ] Create components
- [ ] Test application
</task_progress>`
		: ""
}
</condense>

</explicit_instructions>\n
`

export const newRuleToolResponse = () =>
	`<explicit_instructions type="new_rule">
The user has explicitly asked you to help them create a new Cline rule file inside the .clinerules top-level directory based on the conversation up to this point in time. The user may have provided instructions or additional information for you to consider when creating the new Cline rule.
When creating a new Cline rule file, you should NOT overwrite or alter an existing Cline rule file. To create the Cline rule file you MUST use the new_rule tool. The new_rule tool can be used in either of the PLAN or ACT modes.

The new_rule tool is defined below:

Description:
Your task is to create a new Cline rule file which includes guidelines on how to approach developing code in tandem with the user, which can be either project specific or cover more global rules. This includes but is not limited to: desired conversational style, favorite project dependencies, coding styles, naming conventions, architectural choices, ui/ux preferences, etc.
The Cline rule file must be formatted as markdown and be a '.md' file. The name of the file you generate must be as succinct as possible and be encompassing the main overarching concept of the rules you added to the file (e.g., 'memory-bank.md' or 'project-overview.md').

Parameters:
- Path: (required) The path of the file to write to (relative to the current working directory). This will be the Cline rule file you create, and it must be placed inside the .clinerules top-level directory (create this if it doesn't exist). The filename created CANNOT be "default-clineignore.md". For filenames, use hyphens ("-") instead of underscores ("_") to separate words.
- Content: (required) The content to write to the file. ALWAYS provide the COMPLETE intended content of the file, without any truncation or omissions. You MUST include ALL parts of the file, even if they haven't been modified. The content for the Cline rule file MUST be created according to the following instructions:
  1. Format the Cline rule file to have distinct guideline sections, each with their own markdown heading, starting with "## Brief overview". Under each of these headings, include bullet points fully fleshing out the details, with examples and/or trigger cases ONLY when applicable.
  2. These guidelines can be specific to the task(s) or project worked on thus far, or cover more high-level concepts. Guidelines can include coding conventions, general design patterns, preferred tech stack including favorite libraries and language, communication style with Cline (verbose vs concise), prompting strategies, naming conventions, testing strategies, comment verbosity, time spent on architecting prior to development, and other preferences.
  3. When creating guidelines, you should not invent preferences or make assumptions based on what you think a typical user might want. These should be specific to the conversation you had with the user. Your guidelines / rules should not be overly verbose.
  4. Your guidelines should NOT be a recollection of the conversation up to this point in time, meaning you should NOT be including arbitrary details of the conversation.

Usage:
<new_rule>
<path>.clinerules/{file name}.md</path>
<content>Cline rule file content here</content>
</new_rule>

Example:
<new_rule>
<path>.clinerules/project-preferences.md</path>
<content>
## Brief overview
  [Brief description of the rules, including if this set of guidelines is project-specific or global]

## Communication style
  - [Description, rule, preference, instruction]
  - [...]

## Development workflow
  - [Description, rule, preference, instruction]
  - [...]

## Coding best practices
  - [Description, rule, preference, instruction]
  - [...]

## Project context
  - [Description, rule, preference, instruction]
  - [...]

## Other guidelines
  - [Description, rule, preference, instruction]
  - [...]
</content>
</new_rule>

Below is the user's input when they indicated that they wanted to create a new Cline rule file.
</explicit_instructions>\n
`

export const reportBugToolResponse = () =>
	`<explicit_instructions type="report_bug">
The user has explicitly asked you to help them submit a bug to the Cline github page (you MUST now help them with this irrespective of what your conversation up to this point in time was). To do so you will use the report_bug tool which is defined below. However, you must first ensure that you have collected all required information to fill in all the parameters for the tool call. If any of the the required information is apparent through your previous conversation with the user, you can suggest how to fill in those entries. However you should NOT assume you know what the issue about unless it's clear.
Otherwise, you should converse with the user until you are able to gather all the required details. When conversing with the user, make sure you ask for/reference all required information/fields. When referencing the required fields, use human friendly versions like "Steps to reproduce" rather than "steps_to_reproduce". Only then should you use the report_bug tool call.
The report_bug tool can be used in either of the PLAN or ACT modes.

The report_bug tool call is defined below:

Description:
Your task is to fill in all of the required fields for a issue/bug report on github. You should attempt to get the user to be as verbose as possible with their description of the bug/issue they encountered. Still, it's okay, when the user is unaware of some of the details, to set those fields as "N/A".

Parameters:
- title: (required) Concise description of the issue.
- what_happened: (required) What happened and also what the user expected to happen instead.
- steps_to_reproduce: (required) What steps are required to reproduce the bug.
- api_request_output: (optional) Relevant API request output.
- additional_context: (optional) Any other context about this bug not already mentioned.

Usage:
<report_bug>
<title>Title of the issue</title>
<what_happened>Description of the issue</what_happened>
<steps_to_reproduce>Steps to reproduce the issue</steps_to_reproduce>
<api_request_output>Output from the LLM API related to the bug</api_request_output>
<additional_context>Other issue details not already covered</additional_context>
</report_bug>

Below is the user's input when they indicated that they wanted to submit a Github issue.
</explicit_instructions>\n
`

export const explainChangesToolResponse = () =>
	`<explicit_instructions type="explain_changes">
The user has asked you to explain code changes. You have access to a tool called **generate_explanation** that opens a multi-file diff view with AI-generated inline comments explaining code changes between two git references.

# Important: Use Non-Interactive Commands

When running git or gh commands, always use non-interactive variants to ensure output is returned immediately without requiring user interaction:

- **For git commands**: Use \`git --no-pager\` prefix to disable the pager (e.g., \`git --no-pager log\`, \`git --no-pager diff\`, \`git --no-pager show\`)
- **For gh commands**: Use \`--json\` flag when possible for structured output, or pipe to \`cat\` if needed (e.g., \`gh pr diff 123 | cat\`)

This prevents commands from entering interactive/pager mode which would hang waiting for user input.

# Workflow

Follow these steps to explain code changes:

## 1. Gather Information About the Changes

First, use git or gh CLI tools to understand what changes exist. **Always get the full unified diff output**, not just stats:

- For commits: \`git --no-pager show <commit>\` to see a specific commit's full diff
- For commit ranges: \`git --no-pager log --oneline <from>..<to>\` to see commits in range, then \`git --no-pager diff <from>..<to>\` for full diff
- For branches: \`git --no-pager diff <branch1>..<branch2>\` to see full diff of all changes
- For pull requests: \`gh pr view <number> --json commits,files\` for metadata, then \`gh pr diff <number> | cat\` for full diff
- For staged changes: \`git --no-pager diff --cached\` to see full diff of staged files
- For working directory: \`git --no-pager diff\` for full diff of unstaged changes

To get a comprehensive overview between two refs, run:

**Bash:**
\`\`\`bash
echo "=== COMMITS ==="; git --no-pager log --oneline <from_ref>..<to_ref>; echo "=== CHANGED FILES ==="; git diff <from_ref>..<to_ref> --name-only; echo "=== FULL DIFF ==="; git --no-pager diff <from_ref>..<to_ref>
\`\`\`

**PowerShell:**
\`\`\`powershell
'=== COMMITS ==='; git --no-pager log --oneline <from_ref>..<to_ref>; '=== CHANGED FILES ==='; git diff <from_ref>..<to_ref> --name-only; '=== FULL DIFF ==='; git --no-pager diff <from_ref>..<to_ref>
\`\`\`

Replace \`<from_ref>\` and \`<to_ref>\` with the appropriate git references (commit hashes, branch names, tags, HEAD~1, etc.).

## 2. Build Context for Better Explanations

Before calling generate_explanation, gather context that will help produce more insightful explanations:

- Read relevant files to understand the codebase structure
- Look at related code that the changes interact with
- Check for tests that might explain the intended behavior
- Review any related documentation or comments
- If needed, view file contents at different versions: \`git --no-pager show <ref>:<file>\`

The more context you have in your conversation history, the better the explanations will be since generate_explanation uses the full conversation context when generating comments.

## 3. Determine Git References

Identify the appropriate git references for the diff:

- **from_ref**: The "before" state (commit hash, branch name, tag, HEAD~1, etc.)
- **to_ref**: The "after" state (optional - defaults to working directory if omitted)

Examples of reference combinations:
- Last commit: from_ref="HEAD~1", to_ref="HEAD"
- Specific commit: from_ref="abc123^", to_ref="abc123"
- Branch comparison: from_ref="main", to_ref="feature-branch"
- Staged changes: from_ref="HEAD" (omit to_ref to compare to working directory with staged changes)
- PR changes: from_ref="main", to_ref="pr-branch-name"

## 4. Call generate_explanation

Use the generate_explanation tool with:
- **title**: A descriptive title for the diff view (e.g., "Changes in commit abc123", "PR #42: Add user authentication")
- **from_ref**: The git reference for the "before" state
- **to_ref**: The git reference for the "after" state (optional)
Below is the user's input describing what changes they want explained. If no input is provided, default to analyzing uncommitted changes in the working directory (may or may not be staged).
</explicit_instructions>\n
`

/**
 * Generates the deep-planning slash command response with model-family-aware variant selection
 * @param focusChainSettings Optional focus chain settings to include in the prompt
 * @param providerInfo Optional API provider info for model family detection
 * @param enableNativeToolCalls Optional flag to determine if native tool calling is enabled
 * @returns The deep-planning prompt string with appropriate variant and focus chain settings applied
 */
export const deepPlanningToolResponse = (
	focusChainSettings?: { enabled: boolean },
	providerInfo?: ApiProviderInfo,
	enableNativeToolCalls?: boolean,
) => {
	return getDeepPlanningPrompt(focusChainSettings, providerInfo, enableNativeToolCalls)
}
