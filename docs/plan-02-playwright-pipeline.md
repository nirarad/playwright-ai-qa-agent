# Plan: Playwright Pipeline (Canonical CI + Agent Orchestration)

## Purpose

Define the canonical CI pipeline for running the Playwright showcase suite and triggering the AI failure agent.  
Detailed test-suite design (fixtures, test files, and mode behavior) lives in `docs/plan-02.1-agent-showcase-tests.md`.

---

## Ownership Split (Deduplicated)

- `plan-02-playwright-pipeline.md` (this doc):
  - workflow triggers
  - GitHub Actions job/steps
  - artifacts and failure handling
  - required secrets and demo flow
- `plan-02.1-agent-showcase-tests.md`:
  - single showcase test suite definition (`tests/showcase/*`)
  - fixture contract
  - `QA_MODE` behavior and expected outcomes
  - local run commands

No duplicated test case definitions should exist in this document.

---

## Pipeline Conventions

- Test suite: one set only (`tests/showcase/*`), defined in `plan-02.1`
- Mode injection variable: `QA_MODE` (not `BREAK_MODE`)
- App session bootstrap: `?qaMode=${QA_MODE}`
- Deterministic artifacts for agent:
  - JSON results at `test-results/results.json`
  - HTML report at `test-results/html-report`
- CI browser target: `chromium` only

---

## GitHub Actions Workflow (`.github/workflows/playwright.yml`)

```yaml
name: Playwright + AI QA Agent

on:
  push:
    branches: [main, develop]
  pull_request:
  workflow_dispatch:
    inputs:
      qa_mode:
        description: 'QA mode to inject for this run'
        required: false
        default: 'none'
        type: choice
        options:
          - none
          - selector-change
          - logic-bug
          - auth-break
          - slow-network

jobs:
  test-and-analyze:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install chromium --with-deps

      - name: Run Playwright showcase suite
        id: playwright
        env:
          BASE_URL: ${{ secrets.DEMO_APP_URL }}
          QA_MODE: ${{ github.event.inputs.qa_mode || 'none' }}
          CI: true
        run: npx playwright test -c tests/playwright.config.ts
        continue-on-error: true

      - name: Upload test artifacts
        if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v4
        with:
          name: playwright-results
          path: test-results/
          retention-days: 7

      - name: Run AI Failure Agent
        if: steps.playwright.outcome == 'failure'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_SERVER_URL: ${{ github.server_url }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          GITHUB_RUN_ID: ${{ github.run_id }}
          GITHUB_REF_NAME: ${{ github.ref_name }}
          GITHUB_SHA: ${{ github.sha }}
        run: npm run agent

      - name: Mark job failed if tests failed
        if: steps.playwright.outcome == 'failure'
        run: exit 1
```

`continue-on-error: true` is required so the agent runs after test failures.  
The final explicit `exit 1` preserves failed PR checks.

---

## Playwright Config Requirements

Use the showcase config described in `plan-02.1`:

- `testDir: "./tests/showcase"`
- `retries: 0`
- `workers: 1`
- reporters:
  - list
  - json -> `test-results/results.json`
  - html -> `test-results/html-report`
- artifacts:
  - screenshot: `only-on-failure`
  - trace: `retain-on-failure`
  - video: `retain-on-failure`

---

## Required GitHub Secrets

| Secret | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `DEMO_APP_URL` | Vercel deployment URL (example: `https://taskflow-demo.vercel.app`) |
| `GITHUB_TOKEN` | Auto-provided by GitHub Actions |

---

## Manual Demo Flow

1. Open `Actions` in GitHub.
2. Select `Playwright + AI QA Agent`.
3. Click `Run workflow`.
4. Choose `qa_mode` (for example `selector-change`).
5. Confirm test failure artifacts are uploaded.
6. Confirm agent step runs and creates PR/Issue based on classification.

---

## Reference

For test suite behavior and exact showcase cases, see:

- `docs/plan-02.1-agent-showcase-tests.md`
