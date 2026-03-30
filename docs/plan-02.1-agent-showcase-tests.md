# Plan 02.1: Agent Showcase Tests (Playwright)

## Goal

Create a small, deterministic test suite to showcase AI agent behavior.

- Tests are written as normal product expectations and are expected to pass.
- Tests contain no intentionally failing assertions.
- `qaMode` injection controls app state, not test logic.
- The same tests must fail when run with any non-`none` mode.
- Use only one set of tests (`tests/showcase/*`). Do not maintain separate baseline/scenario suites.

This gives the agent realistic failure data for classification and reporting.

---

## Best-Practice Design

1. Keep tests user-facing and behavior-driven (`data-testid` and visible outcomes).
2. Keep tests isolated by seeding storage per test context.
3. Use one browser project (`chromium`) for deterministic showcase runs.
4. Use `retries: 0` so failure artifacts are clean and classification input is unambiguous.
5. Keep suite small and purposeful; avoid broad coverage in this showcase layer.

---

## Repo Structure

```text
tests/
├── fixtures/
│   └── base.ts
├── showcase/
│   ├── login.spec.ts
│   ├── tasks.spec.ts
│   └── profile.spec.ts
└── playwright.config.ts
```

---

## Mode Strategy

- Runtime mode source: `QA_MODE` env var passed at Playwright run time.
- Session injection: first navigation must include `?qaMode=${QA_MODE}`.
- App bootstrap stores mode in `sessionStorage` (`demo_break_mode`).
- Tests never branch on mode; they always assert normal behavior.

Expected outcome by mode:

| Mode | Expected suite outcome |
|---|---|
| `none` | pass |
| `selector-change` | fail (locators break) |
| `logic-bug` | fail (task assertions break) |
| `auth-break` | fail (login assertions break) |
| `slow-network` | fail (timing-sensitive assertions fail) |

---

## Fixture Contract (`tests/fixtures/base.ts`)

`seededPage`:
- Opens `/?qaMode=${QA_MODE}`
- Seeds `demo_users`, `demo_tasks`
- Clears `demo_session`

`loggedInPage`:
- Same as `seededPage`
- Seeds `demo_session`
- Navigates to `/dashboard`

No mode-specific logic in tests. Mode is injected through fixture setup only.

---

## Playwright Config (`tests/playwright.config.ts`)

Required settings:

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

Why `retries: 0`:
- Multiple retry results add noise to `results.json`.
- Single-failure records are easier for the agent to classify.

---

## Necessary Showcase Tests

### `tests/showcase/login.spec.ts`

Purpose:
- Validate login form is usable.
- Validate successful login redirect.

Failure behavior in non-normal modes:
- `selector-change`: form locators fail.
- `auth-break`: redirect assertion fails.

### `tests/showcase/tasks.spec.ts`

Purpose:
- Validate add task success (title appears).
- Validate empty input is rejected.
- Validate delete flow works.

Failure behavior in non-normal modes:
- `logic-bug`: added task title assertions fail.
- `slow-network`: timing-sensitive assertions fail with tight timeout.

### `tests/showcase/profile.spec.ts`

Purpose:
- Validate display name is visible.
- Validate display name update persists in UI.

Failure behavior in non-normal modes:
- Cascading auth/session or timing issues create failure artifacts for agent evaluation.

---

## Local Run Commands

```bash
# Baseline run: expected pass
QA_MODE=none npx playwright test -c tests/playwright.config.ts

# Agent showcase runs: same tests, expected fail
QA_MODE=selector-change npx playwright test -c tests/playwright.config.ts
QA_MODE=logic-bug npx playwright test -c tests/playwright.config.ts
QA_MODE=auth-break npx playwright test -c tests/playwright.config.ts
QA_MODE=slow-network npx playwright test -c tests/playwright.config.ts
```

---

## CI Usage

- Keep one workflow (defined in `docs/plan-02-playwright-pipeline.md`).
- Pass `qa_mode` workflow input to Playwright as `QA_MODE`.
- Run the same showcase suite each time.
- On failure, run agent step against generated `results.json`.

This keeps demo behavior consistent: one stable suite, mode-driven failures, clean agent outputs.
