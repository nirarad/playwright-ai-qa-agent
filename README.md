# playwright-ai-qa-agent

AI-powered QA pipeline: Playwright tests + an LLM-driven failure agent that classifies failures and (in later phases) reports bugs or opens healing PRs.

## Badges

[![CI](https://github.com/YOUR_ORG/playwright-ai-qa-agent/actions/workflows/playwright.yml/badge.svg)](https://github.com/YOUR_ORG/playwright-ai-qa-agent/actions/workflows/playwright.yml) ![License: MIT](https://img.shields.io/badge/License-MIT-green.svg) ![Node](https://img.shields.io/badge/node-20.x-339933?logo=node.js&logoColor=white)

## What This Is

When an end-to-end test fails, teams lose time deciding whether the problem is a broken locator, a real regression, flaky timing, or a CI/environment issue. This repository turns that decision into a repeatable pipeline step. GitHub Actions runs Playwright and preserves artifacts. The local/dev agent reads failure context from `test-results/results.json` and classifies failures using a configurable provider.

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
       +--> BROKEN_LOCATOR  ---> open PR with healed test locator
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

| Layer | Technology |
|---|---|
| Test framework | Playwright (`@playwright/test`) |
| Language | TypeScript (Node runtime) |
| CI | GitHub Actions |
| AI model | Configurable (`mock`, `anthropic`, `openai`, `google`) |
| Bug tracking | GitHub Issues + Pull Requests |
| Deployment | Vercel (demo app target) |

## How It Works

1. You deploy a small Next.js demo app (TaskFlow) to Vercel and store its URL in GitHub Secrets so CI has a stable target.
2. GitHub Actions runs Playwright against the deployed app and writes both a JSON results file and an HTML report, including screenshots and traces for failures.
3. The workflow is configured to continue past Playwright failures so the agent step always has access to artifacts.
4. The agent reads `test-results/results.json`, extracts failed test cases, and loads the failing test source from the repo.
5. The agent sends failure context (test name, error, stack, and source) to Claude and requests a strict JSON classification.
6. If the classification is `BROKEN_LOCATOR` and confidence is above a threshold, the agent asks Claude for a complete rewritten test file and opens a PR using the GitHub API.
7. If the classification is `REAL_BUG` and confidence is above a threshold, the agent creates a GitHub Issue with the error details and CI run link.
8. The workflow exits with a failure code if Playwright failed so the check is actionable, while still preserving all artifacts and the agent’s output.

## Failure Classification

| Category | What triggers it | Automated action taken |
|---|---|---|
| `BROKEN_LOCATOR` | Element not found, selector mismatch, `data-testid` changed, or DOM shape changed so locators no longer resolve | Open PR that updates the failing test’s locator strategy (confidence-gated) |
| `REAL_BUG` | Assertions fail due to application logic regression (auth/task/profile flows do not behave as expected) | Create GitHub Issue with full failure context (confidence-gated) |
| `FLAKY` | Timing/race conditions, intermittent delays, or order-dependent behavior | Log only |
| `ENV_ISSUE` | CI/environment configuration problems, missing env vars, or external connectivity-like failures | Log only |

## Demo App

TaskFlow is a deliberately small task manager with auth and a few core flows that are realistic enough to test and debug. It uses localStorage instead of a database so it can run on the Vercel free tier without external dependencies. It also includes Break Modes that simulate common failure classes so you can demonstrate the pipeline on demand.

- **Live URL**: `https://playwright-ai-qa-agent.vercel.app`
- **Latest Playwright HTML report (GitHub Pages)**: `https://nirarad.github.io/playwright-ai-qa-agent/`
- **Screenshot**:

```html
<!-- Add screenshot here -->
```

| Break Mode | What it simulates | Expected agent response |
|---|---|---|
| `selector-change` | Internal app `data-testid` changes (tasks/profile) that break locators while login remains stable | `BROKEN_LOCATOR` → PR |
| `logic-bug` | App logic bug (task creation behavior is wrong) | `REAL_BUG` → Issue |
| `slow-network` | Artificial latency that makes tests timing-sensitive | `FLAKY` → log only |
| `auth-break` | Login always fails regardless of credentials | `REAL_BUG` → Issue |

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

2. Install dependencies.

```bash
npm ci
```

3. Set environment variables.

| Variable | Where | Example |
|---|---|---|
| `ANTHROPIC_API_KEY` | local `.env` or GitHub Actions Secret | `YOUR_ANTHROPIC_API_KEY` |
| `DEMO_APP_URL` | GitHub Actions Secret | `https://YOUR_VERCEL_URL.vercel.app` |

4. Run the demo app locally.

```bash
cd demo-app
npm install
npm run dev
```

5. Run Playwright tests.

```bash
npm run test:e2e:none
```

6. Trigger the agent manually (after a failing test run has produced `test-results/results.json`).

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

7. Optional: run tests with preselected QA mode.

```bash
npm run test:e2e:selector-change
npm run test:e2e:logic-bug
npm run test:e2e:auth-break
npm run test:e2e:slow-network
```

## Environment Variables

| Variable | Required | Description |
|---|---:|---|
| `AI_PROVIDER` | No | Provider selection: `mock`, `anthropic`, `openai`, `google` (default: `mock`) |
| `AI_MODEL` | No | Model name passed to the selected provider |
| `AGENT_RESULTS_JSON_PATH` | No | Path to Playwright JSON results file (default: `test-results/results.json`) |
| `AGENT_CONFIDENCE_THRESHOLD` | No | Minimum confidence gate for downstream decisions (default: `0.75`) |
| `AGENT_MAX_FAILURES_PER_RUN` | No | Maximum failures to process per run (default: `3`) |
| `AGENT_ENABLE_IN_CI` | No | Enable agent execution in CI (default: `false` for Phase 1 dev mode) |
| `ANTHROPIC_API_KEY` | Conditionally | Required when `AI_PROVIDER=anthropic` |
| `OPENAI_API_KEY` | Conditionally | Required when `AI_PROVIDER=openai` |
| `GOOGLE_API_KEY` | Conditionally | Required when `AI_PROVIDER=google` |
| `DEMO_APP_URL` | Yes (CI) | Public URL of the deployed TaskFlow app used by Playwright in GitHub Actions |
| `BASE_URL` | No | Override target URL for local runs; defaults to `http://localhost:3000` in the Playwright config |
| `QA_MODE` | No | Optional mode for showcase test runs (`none`, `selector-change`, `logic-bug`, `auth-break`, `slow-network`) |
| `GITHUB_TOKEN` | Yes (CI, provided) | Provided automatically by GitHub Actions for Issues/PRs |
| `GITHUB_REPOSITORY` | Yes (CI, provided) | `owner/repo` used for GitHub API calls |
| `GITHUB_RUN_ID` | Yes (CI, provided) | Used to construct the CI run URL for linking in Issues/PRs |
| `GITHUB_REF_NAME` | Yes (CI, provided) | Branch name used in issue context |
| `GITHUB_SHA` | Yes (CI, provided) | Commit SHA used in issue context |

## Running a Live Demo

1. Open the GitHub Actions tab for the repository and select the Playwright workflow.
2. Click “Run workflow” and choose a `qa_mode` value (for example `selector-change` to force internal locator failures in tasks/profile flows).
3. Watch the Playwright step fail while still uploading the HTML report and JSON results artifact.
4. Confirm the agent step runs after the failure and posts its classification in logs.
5. For `BROKEN_LOCATOR`, expect a PR opened against the repo with an updated test file; for `REAL_BUG`, expect a GitHub Issue created with the error and CI run link.
6. Open the workflow run artifacts and view `test-results/html-report` to show the failure evidence alongside the agent output.

Note: in Phase 1, agent execution is intentionally dev-focused and disabled in CI by default (`AGENT_ENABLE_IN_CI=false`).

## Roadmap

- Make healing POM-aware by including imported page objects in the context prompt
- Attach screenshots to Issues via an artifact link strategy (Issues API does not accept binary uploads)
- Add optional Slack notifications for `REAL_BUG` and repeated `FLAKY` failures
- Add a test-generation agent for new user flows in TaskFlow

## License

MIT
