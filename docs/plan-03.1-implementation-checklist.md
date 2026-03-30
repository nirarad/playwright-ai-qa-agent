# Plan 03.1: AI Failure Agent — Implementation Checklist (LLM-Agnostic)

## Goal

Implement the AI failure agent in small, verifiable steps. The agent must be:

- **LLM-agnostic** (provider adapters behind one interface)
- **Configurable at runtime** (workflow inputs/env override typed defaults)
- **Safe by default** (confidence gates, action toggles, rate limits)
- **CI-friendly** (deterministic inputs from `test-results/results.json`)

This checklist intentionally focuses on *implementation steps*, not redesign.

Phase order and rollout policy are defined in
`docs/plan-03-ai-failure-agent.md` under **Phased Delivery (Rollout Order)**.
This checklist executes that plan and does not redefine phase policy.

---

## Success Criteria (Definition of Done)

- **Context extraction**:
	- Reads Playwright JSON results from `test-results/results.json`
	- Extracts failed tests with error + stack + test file path
	- Loads test source from disk
- **LLM classification**:
	- Produces strict JSON `ClassificationResult`
	- Enforces schema + bounds (`confidence` in \(0..1\), category enum)
	- Handles malformed LLM output with a hard error or “no-action”
- **Config**:
	- One typed config module with defaults
	- Overrides via env vars (for GitHub Actions inputs)
	- Secrets stay in GitHub Secrets only (keys never in repo)
- **Actions**:
	- `REAL_BUG` → creates GitHub Issue (when enabled + confidence gate)
	- `BROKEN_LOCATOR` → opens PR with updated test file (when enabled + confidence gate)
	- No auto-merge
- **Workflow integration**:
	- Agent runs only when Playwright fails
	- Summary contains run context (qa mode, report link, outcome)
	- All artifacts uploaded regardless of failure

---

## Step 0 — Decide Config Inputs (Workflow → Env)

Add/confirm the env var contract the agent will read. Recommended:

- **Provider/model (non-secret)**:
	- `AI_PROVIDER` = `anthropic` | `openai` | `google`
	- `AI_MODEL` = provider model string
- **Thresholds/limits (non-secret)**:
	- `AGENT_CONFIDENCE_THRESHOLD` (e.g. `0.75`)
	- `AGENT_MAX_FAILURES_PER_RUN` (e.g. `3`)
- **Action toggles (non-secret)**:
	- `AGENT_ENABLE_HEAL_PR` = `true` | `false`
	- `AGENT_ENABLE_BUG_ISSUE` = `true` | `false`
- **Secrets (GitHub Secrets only)**:
	- `ANTHROPIC_API_KEY` (if provider is anthropic)
	- `OPENAI_API_KEY` (if provider is openai)
	- `GOOGLE_API_KEY` (if provider is google)

Notes:

- Do **not** pass API keys via workflow inputs.
- Keep defaults in `agent/config.ts`, but allow overrides via env.

---

## Step 1 — Define Core Types

Create/update `agent/types.ts`:

- **`FailureCategory`** enum union:
	- `BROKEN_LOCATOR` | `REAL_BUG` | `FLAKY` | `ENV_ISSUE`
- **`FailureContext`**:
	- `testName`, `testFile`, `testSource`
	- `error`, `errorStack`
	- attachment paths (screenshot/video/trace) when available
	- CI metadata: run URL, branch, sha
- **`ClassificationResult`**:
	- `category`, `confidence`, `reason`, `suggestedFix`

Add a validation helper (planned):

- `assertClassificationResult(value: unknown): ClassificationResult`

---

## Step 2 — Build Config Module (Single Source of Truth)

Create `agent/config.ts`:

- Export:
	- `getAgentConfig(): AgentConfig`
	- `type AgentConfig`
- Defaults:
	- provider, model, maxTokens, temperature
	- confidence threshold
	- max failures per run
	- action toggles
	- base branch (default `main`)
	- results path default `test-results/results.json`
- Env overrides:
	- Parse booleans/numbers safely (reject invalid values)
	- Reject unsupported provider values
- Never read secrets directly in business logic:
	- config defines `apiKeyEnvVar` (string)
	- provider adapter reads `process.env[apiKeyEnvVar]`

---

## Step 3 — Add Provider-Agnostic LLM Interfaces

Create `agent/llm/types.ts`:

- `LlmClient` interface:
	- `classifyFailure({ prompt, maxTokens, temperature }): Promise<string>`
	- `generateFix({ prompt, maxTokens, temperature }): Promise<string>`

Create `agent/llm/factory.ts`:

- `getLlmClient(config: AgentConfig): LlmClient`
- Switch on `config.llm.provider`
- Ensure required API key env var exists (fail fast)

---

## Step 4 — Implement Provider Adapters (One at a Time)

Implement adapters behind `LlmClient`:

- `agent/llm/anthropic-client.ts`
- `agent/llm/openai-client.ts`
- `agent/llm/google-client.ts`

Rules:

- Each adapter returns **raw text** from the model (no JSON parsing inside adapter)
- Adapter must:
	- send the prompt
	- return model response text
	- throw on non-2xx
- Keep request/response mapping isolated per provider

---

## Step 5 — Implement Context Extraction

Create/update `agent/context.ts`:

- Read JSON results from `config.paths.resultsJson`
- Collect failed tests:
	- test title
	- file path
	- error message + stack
	- attachment paths (at minimum screenshot, trace, video if present)
- Read test source from disk for the failing file
- Construct `runUrl` from:
	- `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`

Edge cases to handle:

- Results file missing → no failures (exit 0)
- Test file missing → empty source (still proceed)
- Attachments missing → omit attachment fields

---

## Step 6 — Implement Classification (LLM → JSON → Typed)

Create/update `agent/classifier.ts`:

- Build a single deterministic classification prompt:
	- list categories + definitions
	- require strict JSON output only
	- include:
		- test name
		- test file path
		- error + stack
		- test source
- Call:
	- `const config = getAgentConfig()`
	- `const llm = getLlmClient(config)`
	- `raw = await llm.classifyFailure(...)`
- Parse + validate:
	- `JSON.parse(raw)`
	- `assertClassificationResult(parsed)`
- On invalid JSON or validation failure:
	- treat as “no-action” or throw (pick one strategy and document)

---

## Step 7 — Implement Reporter (REAL_BUG → GitHub Issue)

Create/update `agent/reporter.ts`:

- Build issue body including:
	- branch + sha
	- run URL
	- error + stack
	- classification (category/confidence/reason)
	- failing test name + file
	- link to HTML report if available (optional)
- Use GitHub REST API with `GITHUB_TOKEN`
- Labeling:
	- `bug`, `automated-qa` (or repo standard)

---

## Step 8 — Implement Healer (BROKEN_LOCATOR → PR)

Create/update `agent/healer.ts`:

- Only run if enabled + confidence above threshold
- Fix prompt requirements:
	- “Return ONLY the complete fixed test file content”
	- No markdown fences, no extra text
- Write the fixed test file to a new branch via GitHub API:
	- Create branch from `config.github.baseBranch`
	- Update file content using Contents API
	- Open PR (base is `config.github.baseBranch`)

Safety:

- No force pushes
- No auto-merge
- PR body includes run URL + confidence + reason

---

## Step 9 — Orchestrator (Wiring + Gates)

Create/update `agent/orchestrator.ts`:

- Load config once
- `failures = extractFailures().slice(0, config.limits.maxFailuresPerRun)`
- For each failure:
	- classify
	- if confidence < threshold → skip
	- switch category:
		- `BROKEN_LOCATOR` → heal if enabled
		- `REAL_BUG` → issue if enabled
		- `FLAKY`/`ENV_ISSUE` → log only

Exit behavior:

- Exit 0 if no failures
- Exit non-zero only for internal errors (not for “skipped action”)

---

## Step 10 — GitHub Actions Wiring

Update workflow (later implementation step):

- Ensure Playwright step continues on error (already done)
- Ensure artifacts upload always runs (already done)
- Add agent step after Playwright with:
	- `if: steps.playwright.outcome == 'failure'`
	- env var wiring for config overrides
	- required secrets

Also ensure the run Summary includes:

- BASE_URL
- QA_MODE
- agent config highlights (provider/model/threshold) (optional)
- HTML report link (already done via Pages deploy)

---

## Step 11 — Testing Strategy

Unit tests (recommended):

- `config` parsing:
	- valid overrides
	- invalid numeric/boolean values
	- unsupported provider
- classification result validation
- context extractor parsing of a saved `results.json` fixture

Integration tests (optional):

- Run orchestrator in “dry-run” mode (if added later) that logs intended actions

---

## Step 12 — Operational Notes

- Keep prompts stable for reproducibility.
- Avoid adding fallback behaviors without explicit requirement.
- Do not log secrets. If logging provider config, redact keys.

---

## Step 13 — Dev Mode Workflow (Composer + Terminal)

Use this mode for local development and demo iteration.

- **Authoring**:
	- Use Composer 2 locally to plan and implement code changes.
	- Keep changes scoped to one checklist step at a time.
- **Execution**:
	- Run the agent from terminal (not from Composer):
		- `npm run agent`
	- For direct execution/debug:
		- `npx tsx agent/orchestrator.ts`
- **Validation loop**:
	1. Generate fresh Playwright artifacts (`test-results/results.json`).
	2. Run the agent from terminal.
	3. Inspect logs/output and action gating.
	4. Refine prompts/config and repeat.
- **Recommended dev defaults**:
	- Use action toggles that match the current rollout phase from `plan-03`.
	- Keep cost and noise low:
		- `AGENT_MAX_FAILURES_PER_RUN=1`
		- confidence threshold at or above `0.75`

---

## Step 14 — CI Guardrails (Required for Agent Execution)

Before enabling agent actions in GitHub Actions, enforce these guardrails.

- **Run conditions**:
	- Run agent only when Playwright step outcome is `failure`.
	- Skip agent on cancelled workflows.
	- Do not run write actions on untrusted fork PRs.
- **Event/branch policy**:
	- Allow full write actions on protected internal events only:
		- `push` to approved branches
		- `workflow_dispatch` by maintainers
	- For `pull_request`:
		- default to classify/log only (no Issue/PR writes), or skip fully.
- **Write-action gates**:
	- `AGENT_ENABLE_BUG_ISSUE=true|false`
	- `AGENT_ENABLE_HEAL_PR=true|false`
	- Toggle values must follow the active phase policy in `plan-03`.
- **Confidence + volume controls**:
	- Enforce `AGENT_CONFIDENCE_THRESHOLD` before any write action.
	- Enforce `AGENT_MAX_FAILURES_PER_RUN` hard cap.
	- Process failures sequentially to avoid burst writes.
- **Target safety**:
	- PR base branch must come from config (`github.baseBranch`) and be allowlisted.
	- Generated branch names must be sanitized and length-limited.
	- No force push, no auto-merge, no direct commits to base branch.
- **Permissions principle**:
	- Use least-privilege workflow permissions.
	- Grant `issues: write` only when issue creation is enabled.
	- Grant `pull-requests: write` and `contents: write` only when healer is enabled.
- **Secrets and logging**:
	- Read API keys from GitHub Secrets only.
	- Never print secrets or full provider responses that may include sensitive data.
	- Log only redacted config (provider/model/thresholds, no keys).
- **Idempotency / duplicate prevention**:
	- Prevent duplicate issues for same failing test + commit + category.
	- Prevent opening multiple heal PRs for the same test/commit in one run.
- **Failure behavior**:
	- Agent internal errors should not erase Playwright artifacts.
	- Keep final job failure semantics tied to Playwright test outcome.
	- Record agent outcome in run summary (success/skip/error and reason).

