# playwright-ai-qa-agent

AI-powered QA pipeline: Playwright tests + an LLM-driven failure agent that classifies failures and (in later phases) reports bugs or opens healing PRs.

## Badges

[CI](https://github.com/YOUR_ORG/playwright-ai-qa-agent/actions/workflows/playwright.yml) License: MIT Node

## What This Is

When an end-to-end test fails, teams lose time deciding whether the problem is a broken locator, a real regression, flaky timing, or a CI/environment issue. This project turns that decision into a repeatable pipeline step. GitHub Actions runs Playwright and preserves artifacts. The local/dev agent reads failure context from `test-results/results.json` and classifies failures using a configurable provider.

## Architecture Diagram

```text
GitHub Actions
  |
  v
Run Playwright tests (JSON + HTML reports, screenshots/traces)
  |
  +-- success ------------------------------> ✅ Job passes
  |
  +-- failure
       |
       v
   Agent reads Playwright results.json + failure context
       |
       v
   Claude API classifies failure
       |
  +--> BROKEN_LOCATOR  ---> create `AUTOMATION_BUG` Issue (+ optional linked healer PR)
       |
       +--> REAL_BUG        ---> create GitHub Issue with failure context
       |
       +--> FLAKY           ---> log only (no automated write action)
       |
       +--> ENV_ISSUE       ---> log only (no automated write action)
       |
       v
   CI ends failed (PR checks are red, artifacts preserved)
```

## Tech Stack


| Layer          | Technology                                                       |
| -------------- | ---------------------------------------------------------------- |
| Test framework | Playwright (`@playwright/test`)                                  |
| Language       | TypeScript (Node runtime)                                        |
| CI             | GitHub Actions                                                   |
| AI model       | Configurable (`mock`, `anthropic`, `openai`, `google`, `ollama`) |
| Bug tracking   | GitHub Issues + Pull Requests                                    |
| Deployment     | Vercel (demo app target)                                         |


## How It Works

1. You deploy a small Next.js demo app (TaskFlow) to Vercel and store its URL in GitHub Secrets so CI has a stable target.
2. GitHub Actions runs Playwright against the deployed app and writes both a JSON results file and an HTML report, including screenshots and traces for failures.
3. The workflow is configured to continue past Playwright failures so the agent step always has access to artifacts.
4. The agent reads `test-results/results.json`, extracts failed test cases, and loads the failing test source from the repo.
5. The agent sends failure context (test name, error, stack, and source) to Claude and requests a strict JSON classification.
6. If the classification is `BROKEN_LOCATOR` and confidence is above a threshold, the agent creates a GitHub Issue titled with `AUTOMATION_BUG` and includes the locator that needs an update plus suggested fix direction.
7. If the classification is `REAL_BUG` and confidence is above a threshold, the agent creates a GitHub Issue with the error details and CI run link.
8. The workflow exits with a failure code if Playwright failed so the check is actionable, while still preserving all artifacts and the agent’s output.

## Failure Classification


| Category         | What triggers it                                                                                                | Automated action taken                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `BROKEN_LOCATOR` | Element not found, selector mismatch, `data-testid` changed, or DOM shape changed so locators no longer resolve | Create `AUTOMATION_BUG` Issue with locator update details; if healer is enabled, also open a linked PR (`Closes #issue`) |
| `REAL_BUG`       | Assertions fail due to application logic regression (auth/task/profile flows do not behave as expected)         | Create GitHub Issue with full failure context (confidence-gated)            |
| `FLAKY`          | Timing/race conditions, intermittent delays, or order-dependent behavior                                        | Log only                                                                    |
| `ENV_ISSUE`      | CI/environment configuration problems, missing env vars, or external connectivity-like failures                 | Log only                                                                    |


## Demo App

TaskFlow is a deliberately small task manager with auth and a few core flows that are realistic enough to test and debug. It uses localStorage instead of a database so it can run on the Vercel free tier without external dependencies. It also includes Break Modes that simulate common failure classes so you can demonstrate the pipeline on demand.

- **Live URL**: `https://playwright-ai-qa-agent.vercel.app`
- **Latest Playwright HTML report (GitHub Pages)**: `https://nirarad.github.io/playwright-ai-qa-agent/`
- **Screenshot**:

```html
<!-- Add screenshot here -->
```


| Break Mode        | What it simulates                                                                                 | Expected agent response |
| ----------------- | ------------------------------------------------------------------------------------------------- | ----------------------- |
| `selector-change` | Internal app `data-testid` changes (tasks/profile) that break locators while login remains stable | `BROKEN_LOCATOR` → `AUTOMATION_BUG` Issue (+ healer PR when enabled)   |
| `logic-bug`       | App logic bug (task creation behavior is wrong)                                                   | `REAL_BUG` → Issue      |
| `slow-network`    | Artificial latency that makes tests timing-sensitive                                              | `FLAKY` → log only      |
| `auth-break`      | Login always fails regardless of credentials                                                      | `REAL_BUG` → Issue      |


### `qaMode` Session Injection

Use `qaMode` query param when opening a new browser session to preselect QA mode for that session.

- `none`
- `selector-change`
- `logic-bug`
- `slow-network`
- `auth-break`

Examples:

```text
https://YOUR_VERCEL_URL.vercel.app/?qaMode=none
https://YOUR_VERCEL_URL.vercel.app/?qaMode=selector-change
https://YOUR_VERCEL_URL.vercel.app/?qaMode=logic-bug
https://YOUR_VERCEL_URL.vercel.app/?qaMode=slow-network
https://YOUR_VERCEL_URL.vercel.app/?qaMode=auth-break
```

Notes:

- `qaMode` is session-scoped and stored in `sessionStorage`.
- It applies to the current tab/session only.
- The app removes `qaMode` from the URL after bootstrap.

## Project Structure

```text
.
├── .cursor/                         # Cursor rules for consistent agent behavior
│   └── rules/
│       ├── cursor-rules.mdc         # Rule authoring conventions
│       ├── self-improve.mdc         # Rule improvement + safety constraints
│       └── tech-stack.mdc           # Stack decisions and repo-wide best practices
├── .github/
│   └── workflows/
│       └── playwright.yml           # CI pipeline: Playwright + agent on failure (planned)
├── agent/
│   ├── orchestrator.ts              # Main entry point (planned)
│   ├── classifier.ts                # Claude classification (planned)
│   ├── healer.ts                    # Generate fix + open PR (planned)
│   ├── reporter.ts                  # Create GitHub Issue (planned)
│   ├── context.ts                   # Extract failure context from artifacts (planned)
│   └── types.ts                     # Shared agent types (planned)
├── demo-app/                        # Next.js 14 TaskFlow demo app (planned)
├── docs/
│   ├── plan-00-general.md           # Phased roadmap and exit criteria
│   ├── plan-01-demo-web-app.md      # TaskFlow demo app plan (Next.js + Vercel)
│   ├── plan-02-playwright-pipeline.md # Playwright suite + GitHub Actions pipeline plan
│   └── plan-03-ai-failure-agent.md  # AI failure agent plan (classify → act)
├── tests/                           # Playwright test suite (planned)
├── LICENSE                          # MIT license
└── README.md                        # You are here
```

## Getting Started

### Prerequisites

- Node.js `20.x`
- An Anthropic API key (for Claude)
- A deployed demo app URL (Vercel)

### Setup

1. Clone the repository.

```bash
git clone https://github.com/YOUR_ORG/playwright-ai-qa-agent.git
cd playwright-ai-qa-agent
```

1. Install dependencies.

```bash
npm ci
```

1. Set environment variables.


| Variable            | Where                                 | Example                              |
| ------------------- | ------------------------------------- | ------------------------------------ |
| `ANTHROPIC_API_KEY` | local `.env` or GitHub Actions Secret | `YOUR_ANTHROPIC_API_KEY`             |
| `DEMO_APP_URL`      | GitHub Actions Secret                 | `https://YOUR_VERCEL_URL.vercel.app` |


1. Run the demo app locally.

```bash
cd demo-app
npm install
npm run dev
```

1. Run Playwright tests.

```bash
npm run test:e2e:none
```

### Run Playwright: `BASE_URL`, `QA_MODE`, and headed mode

Playwright reads `BASE_URL` (see `tests/playwright.config.ts`). It defaults to `http://localhost:3000` for a local `npm run dev` in `demo-app/`. Set `BASE_URL` to your deployed origin to run against production **without** starting the app locally. Showcase tests also honor `QA_MODE` (`none`, `selector-change`, `logic-bug`, `auth-break`, `slow-network`).

Set `BASE_URL`, `QA_MODE`, and the npm script in one shell. Examples use this repo’s public demo URL (change both if you deploy elsewhere).

**PowerShell** (Windows default terminal: use `$env:` — Unix-style `VAR=value cmd` is **not** valid in PowerShell). From the **repository root**:

```powershell
$env:BASE_URL='https://playwright-ai-qa-agent.vercel.app'
$env:QA_MODE='none'
npm run test:e2e:headed -w demo-app
```

Same variables for headless, local target, or `demo-app/` (after `cd demo-app`); only the last line changes:

```powershell
# Production — headless
$env:BASE_URL='https://playwright-ai-qa-agent.vercel.app'
$env:QA_MODE='none'
npm run test:e2e -w demo-app

# Local dev server (explicit base URL matches Playwright default)
$env:BASE_URL='http://localhost:3000'
$env:QA_MODE='none'
npm run test:e2e:headed -w demo-app

# From demo-app/
$env:BASE_URL='https://playwright-ai-qa-agent.vercel.app'
$env:QA_MODE='none'
npm run test:e2e:headed
```

One-liner equivalent:

```powershell
$env:BASE_URL='https://playwright-ai-qa-agent.vercel.app'; $env:QA_MODE='none'; npm run test:e2e:headed -w demo-app
```

**Git Bash, WSL, macOS, or Linux** — prefix assignment works on one line:

```bash
# Production — headless
BASE_URL=https://playwright-ai-qa-agent.vercel.app QA_MODE=none npm run test:e2e -w demo-app

# Production — headed
BASE_URL=https://playwright-ai-qa-agent.vercel.app QA_MODE=none npm run test:e2e:headed -w demo-app

# Local — omit BASE_URL or set BASE_URL=http://localhost:3000
QA_MODE=none npm run test:e2e -w demo-app
QA_MODE=none npm run test:e2e:headed -w demo-app
```

**Command Prompt (`cmd.exe`)**:

```bat
set "BASE_URL=https://playwright-ai-qa-agent.vercel.app" && set "QA_MODE=none" && npm run test:e2e:headed -w demo-app
```

The root shortcuts `npm run test:e2e:none`, `npm run test:e2e:selector-change`, and similar use **`cmd.exe`-style** `set "QA_MODE=..."` in `package.json` scripts; in PowerShell, prefer the `$env:` blocks above instead of those shortcuts, or run them from **cmd**.

1. Trigger the agent manually (after a failing test run has produced `test-results/results.json`).

```bash
npm run agent
```

### Run Agent With Explicit Results Path

Use `AGENT_RESULTS_JSON_PATH` to point the agent to a specific results file.

PowerShell:

```powershell
$env:AI_PROVIDER='mock'
$env:AGENT_RESULTS_JSON_PATH='test-results/results.json'
npm run agent
```

If your file is elsewhere:

```powershell
$env:AI_PROVIDER='mock'
$env:AGENT_RESULTS_JSON_PATH='test-results/my-run/results.json'
npm run agent
```

### Local Dev Provider Examples

Mock provider (free, deterministic):

```powershell
$env:AI_PROVIDER='mock'
npm run agent
```

Ollama provider (local):

```powershell
$env:AI_PROVIDER='ollama'
$env:AI_MODEL='qwen2.5:7b'
$env:OLLAMA_BASE_URL='http://127.0.0.1:11434'
npm run agent:local-results
```

### Run Ollama with Docker

Build image:

```bash
docker build -t qa-agent-ollama ./ollama
```

Run container and pre-pull a model (example: **8 CPUs**, **all NVIDIA GPUs**; omit `--gpus all` if you have no GPU):

```bash
docker run --rm --gpus all --cpus=8 -p 11434:11434 -e OLLAMA_PULL_MODEL=qwen2.5:7b -e OLLAMA_KEEP_ALIVE=30m qa-agent-ollama
```

**NVIDIA GPU (Windows + Docker Desktop):** install the latest **Game Ready / Studio** driver for your card, enable **WSL2**, use **Docker Desktop** with the **WSL2** backend, and turn on **GPU support** in Docker Desktop settings. Then confirm the GPU is visible to Docker, for example: `docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi`. After `qa-agent-ollama` is running, `docker exec qa-agent-ollama nvidia-smi` should list your GPU; Ollama logs should show CUDA inference (not only `library=cpu`). If `docker compose up` fails with a GPU / device-driver error and you need CPU-only, either remove the `deploy.resources.reservations.devices` block from `ollama/docker-compose.yml` (keep `limits.cpus`), or run: `docker compose -f ollama/docker-compose.yml -f ollama/docker-compose.cpu-only.yml up --build -d`.

Run via terminal (detached):

The image builds with the same defaults (`11434`, `OLLAMA_PULL_MODEL=qwen2.5:7b`); models persist in the `ollama-data` volume. Compose allows **8 CPUs** by default and requests **NVIDIA GPUs** for inference; override CPUs with e.g. `$env:OLLAMA_DOCKER_CPUS='6'` before `docker compose` if you want to leave headroom for the host. Compose sets `**OLLAMA_KEEP_ALIVE=30m`** and `**shm_size: 2gb**`.

```bash
docker compose -f ollama/docker-compose.yml up --build -d
```

Then run the agent with:

```powershell
$env:AI_PROVIDER='ollama'
$env:AI_MODEL='qwen2.5:7b'
$env:OLLAMA_BASE_URL='http://127.0.0.1:11434'
npm run agent:local-results
```

1. Optional: run tests with preselected QA mode.

```bash
npm run test:e2e:selector-change
npm run test:e2e:logic-bug
npm run test:e2e:auth-break
npm run test:e2e:slow-network
```

## Environment Variables

### Agent and CI (general)


| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `AGENT_RESULTS_JSON_PATH` | No | `test-results/results.json` | Path to Playwright JSON results file |
| `AGENT_CONFIDENCE_THRESHOLD` | No | `0.75` | Minimum confidence gate for downstream decisions |
| `AGENT_MAX_FAILURES_PER_RUN` | No | `3` | Maximum failures to process per run |
| `AGENT_ENABLE_IN_CI` | No | `false` | Enable agent execution in CI (Phase 1 default is disabled) |
| `AGENT_ENABLE_BUG_ISSUE` | No | `false` | Enable GitHub Issue creation when confidence is above threshold |
| `AGENT_ENABLE_HEAL_PR` | No | `false` | Enable healer PR creation for `BROKEN_LOCATOR` when confidence is above threshold |
| `AGENT_ISSUE_LABELS` | No | `bug,automated-qa` | Comma-separated labels applied to created issues |
| `AGENT_GITHUB_BASE_BRANCH` | No | `main` | Base branch for healer PRs |
| `AGENT_INTER_REQUEST_DELAY_MS` | No | `750` | Delay between processing failures |
| `AGENT_LOG_LEVEL` | No | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `AGENT_LOG_PRETTY` | No | `false` | Pretty-print logs with multiline context |
| `GITHUB_API_URL` | No | `https://api.github.com` | GitHub API base URL override (useful for GHES) |
| `DEMO_APP_URL` | Yes (CI) | n/a | Public URL of the deployed TaskFlow app used by Playwright in GitHub Actions |
| `BASE_URL` | No | `http://localhost:3000` | Override target URL for local runs |
| `QA_MODE` | No | `none` | Optional mode for showcase test runs (`none`, `selector-change`, `logic-bug`, `auth-break`, `slow-network`) |
| `GITHUB_TOKEN` | Yes (CI, provided) | provided by Actions | Used for Issues/PRs GitHub API calls |
| `GITHUB_REPOSITORY` | Yes (CI, provided) | provided by Actions | `owner/repo` used for GitHub API calls |
| `GITHUB_RUN_ID` | Yes (CI, provided) | provided by Actions | Used to construct the CI run URL for linking in Issues/PRs |
| `GITHUB_REF_NAME` | Yes (CI, provided) | provided by Actions | Branch name used in issue context |
| `GITHUB_SHA` | Yes (CI, provided) | provided by Actions | Commit SHA used in issue context |


### LLM routing (all providers)


| Variable      | Required | Description                                                                             |
| ------------- | -------- | --------------------------------------------------------------------------------------- |
| `AI_PROVIDER` | No       | Provider selection: `mock`, `anthropic`, `openai`, `google`, `ollama` (default: `mock`) |
| `AI_MODEL`    | No       | Model name passed to the selected provider                                              |
| `AGENT_MAX_TOKENS_CLASSIFY` | No | Token budget for classification calls (default: `600`) |
| `AGENT_TEMPERATURE_CLASSIFY` | No | Temperature for classification calls (default: `0`) |
| `AGENT_MAX_TOKENS_HEAL` | No | Token budget for healer generation calls (default: `14000`) |
| `AGENT_TEMPERATURE_HEAL` | No | Temperature for healer generation calls (default: `0`) |
| `AGENT_LLM_MAX_ATTEMPTS` | No | LLM request retry attempts (default: `3`) |
| `AGENT_LLM_RETRY_INITIAL_DELAY_MS` | No | Initial retry delay (default: `1000`) |
| `AGENT_LLM_RETRY_MAX_DELAY_MS` | No | Max retry delay cap (default: `8000`) |


### Anthropic (Claude)


| Variable            | Required      | Description                           |
| ------------------- | ------------- | ------------------------------------- |
| `ANTHROPIC_API_KEY` | Conditionally | Required when `AI_PROVIDER=anthropic` |


### OpenAI


| Variable         | Required      | Description                        |
| ---------------- | ------------- | ---------------------------------- |
| `OPENAI_API_KEY` | Conditionally | Required when `AI_PROVIDER=openai` |
| `OPENAI_BASE_URL` | Optional | Override OpenAI API base URL (default: `https://api.openai.com/v1`) |


### Google


| Variable         | Required      | Description                        |
| ---------------- | ------------- | ---------------------------------- |
| `GOOGLE_API_KEY` | Conditionally | Required when `AI_PROVIDER=google` |
| `GOOGLE_BASE_URL` | Optional | Override Google API base URL (default: `https://generativelanguage.googleapis.com/v1beta/models`) |


### Ollama (local)


| Variable                               | Required      | Description                                                                                                           |
| -------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `OLLAMA_BASE_URL`                      | Conditionally | Ollama base URL when `AI_PROVIDER=ollama` (default: `http://127.0.0.1:11434`)                                         |
| `OLLAMA_REQUEST_TIMEOUT_MS`            | Optional      | Abort Ollama `/api/generate` after this many ms (`0` or unset = no limit). Large prompts on CPU can take many minutes |
| `AGENT_OLLAMA_MAX_DOM_CHARS`           | Optional      | Cap DOM snapshot chars for `ollama` (default `8000`; smaller = faster CPU runs)                                       |
| `AGENT_OLLAMA_MAX_ERROR_CONTEXT_CHARS` | Optional      | Cap error-context markdown for `ollama` (default `6000`)                                                              |
| `AGENT_OLLAMA_MAX_TEST_SOURCE_CHARS`   | Optional      | Cap test file source for `ollama` (default `10000`)                                                                   |
| `AGENT_OLLAMA_MAX_CLASSIFY_PREDICT`    | Optional      | Max decode tokens per classify call for `ollama` (default `384`; lowers latency vs `AGENT_MAX_TOKENS_CLASSIFY`)       |
| `AGENT_OLLAMA_NUM_CTX_MIN`             | Optional      | Lower bound for Ollama `num_ctx` (default `4096`)                                                                     |
| `AGENT_OLLAMA_NUM_CTX_MAX`             | Optional      | Upper bound for Ollama `num_ctx` (default `16384`; trim prompts before raising)                                       |
| `OLLAMA_API_KEY`                       | Optional      | Optional key if Ollama endpoint is behind auth/proxy                                                                  |


## Running a Live Demo

1. Open the GitHub Actions tab for the repository and select the Playwright workflow.
2. Click “Run workflow” and choose a `qa_mode` value (for example `selector-change` to force internal locator failures in tasks/profile flows).
3. Watch the Playwright step fail while still uploading the HTML report and JSON results artifact.
4. Confirm the agent step runs after the failure and posts its classification in logs.
5. For `BROKEN_LOCATOR`, expect a GitHub Issue titled with `AUTOMATION_BUG` and locator update guidance; when healer is enabled, also expect a linked PR that includes `Closes #<issue-number>`. For `REAL_BUG`, expect a GitHub Issue created with the error and CI run link.
6. Open the workflow run artifacts and view `test-results/html-report` to show the failure evidence alongside the agent output.

Note: in Phase 1, agent execution is intentionally dev-focused and disabled in CI by default (`AGENT_ENABLE_IN_CI=false`).

## Roadmap

- Make healing POM-aware by including imported page objects in the context prompt
- Attach screenshots to Issues via an artifact link strategy (Issues API does not accept binary uploads)
- Add optional Slack notifications for `REAL_BUG` and repeated `FLAKY` failures
- Add a test-generation agent for new user flows in TaskFlow

## License

MIT