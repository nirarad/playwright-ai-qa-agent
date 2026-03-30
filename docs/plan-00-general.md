# General Plan: Playwright Pipeline + Demo App + AI Failure Agent

## Goal

Build a portfolio-friendly end-to-end system where:

- A **deployable demo web app** provides realistic, breakable user flows
- A **Playwright test suite** validates those flows and intentionally fails under controlled “Break Mode” states
- A **GitHub Actions pipeline** runs tests, uploads artifacts, and (on failure) triggers an **AI failure agent** that classifies failures and opens the appropriate GitHub action (PR vs Issue)

---

## Guiding Principles

- **Deterministic demos**: failures must be reproducible on demand (Break Mode)
- **No paid infra required**: demo app deploys to Vercel free tier; storage is local-only
- **Artifact-first debugging**: pipeline always uploads Playwright HTML report + JSON results
- **Safety rails**: AI agent only takes action when confidence is high
- **Human-in-the-loop**: any generated PR is for review, not auto-merge
- **Reproducible randomness**: any “chance-based” failures must be seedable for CI

---

## Phase 0 — Repo Baseline

**Outcome**: a coherent monorepo layout and shared tooling.

- Establish top-level folders:
	- `demo-app/`: Next.js app (deploy target)
	- `tests/`: Playwright tests (or colocate under `qa-ai-agent/` if you prefer)
	- `agent/`: AI failure agent (TypeScript runtime)
	- `.github/workflows/`: CI pipeline
- Standardize Node + TypeScript expectations for all packages
- Add minimal docs for running locally and in CI

Exit criteria:

- A new developer can run the demo app locally and run tests locally
- CI can install deps and run at least one smoke test

---

## Phase 1 — Demo Web App (Next.js + Tailwind + Vercel)

**Outcome**: a small Task Manager app with authentication and breakable modes.

Build the app described in `docs/plan-01-demo-web-app.md`:

- Routes:
	- `/`, `/login`, `/register`, `/dashboard`, `/profile`
- Data model stored in `localStorage`:
	- users, session, tasks, break mode
- Break Mode toggles (dev panel):
	- `selector-change`: rename `data-testid` attributes (locator break)
	- `logic-bug`: corrupt task creation logic (real bug)
	- `slow-network`: add delay (flaky)
	- `auth-break`: login always fails (real bug)
- Vercel feature flags (fixed or chance-based):
	- UI changes (element/attribute changes → locator failures)
	- bug injection (logic failures)
	- env issue injection (misconfig/infra-like failures)
	- chance-based flags must be deterministic under a provided seed
- Ensure key elements have stable `data-testid` identifiers in normal mode

Exit criteria:

- App is deployable to Vercel and works end-to-end
- Break Mode + Vercel feature flags can be set and observed reliably (including seeded chance)

---

## Phase 2 — Playwright Test Suite

**Outcome**: tests cover core flows and can be forced to fail via Break Mode.

Implement the suite described in `docs/plan-02-playwright-pipeline.md`:

- Tests:
	- Auth: login/register
	- Tasks: add/complete/delete
	- Profile: view/update display name
- Fixtures:
	- deterministic localStorage seeding
	- “logged-in page” helper
- Reporting:
	- JSON results written to `test-results/results.json`
	- HTML report written to `test-results/html-report`
	- screenshot/trace/video capture on failure per config

Exit criteria:

- Tests pass in normal mode against local and deployed app
- At least one break mode or feature flag produces each intended failure category signal

---

## Phase 3 — GitHub Actions Pipeline

**Outcome**: CI runs tests, uploads artifacts, and triggers the agent on failures.

Implement the workflow described in `docs/plan-02-playwright-pipeline.md`:

- Node 20 setup + `npm ci`
- Install Playwright browser deps (Chromium)
- Run tests with `continue-on-error: true`
- Upload `test-results/` artifacts on every run
- If Playwright step failed, run agent
- After agent, hard-fail the workflow so PR checks reflect failures

Exit criteria:

- A failing run still uploads artifacts and runs the agent
- The workflow ends in failed state when tests fail
- Feature flags can be controlled from CI (fixed + seeded chance)

---

## Phase 4 — AI Failure Agent (Classify → Act)

**Outcome**: an agent that reads Playwright failure context and performs one GitHub action.

Implement the agent described in `docs/plan-03-ai-failure-agent.md`:

- Inputs:
	- Playwright JSON results
	- failing test source
	- error message/stack
	- optional screenshot (base64)
	- GitHub run metadata via env vars
- Classification (Anthropic):
	- Categories:
		- `BROKEN_LOCATOR`
		- `REAL_BUG`
		- `FLAKY`
		- `ENV_ISSUE`
	- Return strict JSON
- Actions:
	- `BROKEN_LOCATOR` + high confidence: generate fixed test source and open PR
	- `REAL_BUG`: open GitHub Issue with context
	- `FLAKY` / `ENV_ISSUE`: no automated code changes by default
- Safeguards:
	- confidence threshold gating
	- limit number of processed failures per run during development

Exit criteria:

- A known locator break results in a PR being opened
- A known app logic break results in a GitHub Issue being created

---

## Phase 5 — Demo/Portfolio Polish

**Outcome**: smooth, repeatable demo with a scripted narrative.

- Add “demo script” steps and screenshots to docs
- Ensure the app can surface Dev Panel in a demo-friendly way
- Validate secrets required in GitHub + Vercel
- Ensure logs are readable and artifacts are easy to find

Exit criteria:

- You can run a 3–5 minute demo: trigger break mode → CI fails → agent runs → PR/Issue created

