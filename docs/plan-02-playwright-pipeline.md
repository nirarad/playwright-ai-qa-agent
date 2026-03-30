# Plan: Playwright Test Suite + GitHub Actions Pipeline

## Purpose

A Playwright test suite that covers the demo app's core flows. Tests are written to exercise the Break Mode states so the AI agent has real failures to classify and act on. The GitHub Actions pipeline runs the suite and triggers the agent on failure.

---

## Repo Structure

```
tests/
├── auth/
│   ├── login.spec.ts
│   └── register.spec.ts
├── tasks/
│   ├── add-task.spec.ts
│   ├── complete-task.spec.ts
│   └── delete-task.spec.ts
├── profile/
│   └── profile.spec.ts
├── fixtures/
│   └── base.ts              # Extended test fixture with seed + auth helpers
└── helpers/
    └── auth-helpers.ts
```

---

## `playwright.config.ts`

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,         // sequential for demo clarity
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/results.json" }],
    ["html", { outputFolder: "test-results/html-report", open: "never" }],
  ],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
```

---

## Base Fixture (`tests/fixtures/base.ts`)

Extends Playwright's `test` with helpers for seeding localStorage and logging in.

```typescript
import { test as base, Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

export interface TestFixtures {
  seededPage: Page;
  loggedInPage: Page;
}

export const test = base.extend<TestFixtures>({
  // seededPage: navigates to app and injects seed data into localStorage
  seededPage: async ({ page }, use) => {
    await page.goto(BASE_URL);

    await page.evaluate(() => {
      localStorage.setItem(
        "demo_users",
        JSON.stringify([
          {
            id: "user-001",
            email: "test@example.com",
            password: "password123",
            displayName: "Test User",
          },
        ])
      );
      localStorage.setItem("demo_tasks", JSON.stringify([]));
      localStorage.setItem("demo_break_mode", "none");
    });

    await use(page);
  },

  // loggedInPage: seeded + already authenticated
  loggedInPage: async ({ page }, use) => {
    await page.goto(BASE_URL);

    await page.evaluate(() => {
      const user = {
        id: "user-001",
        email: "test@example.com",
        password: "password123",
        displayName: "Test User",
      };
      localStorage.setItem("demo_users", JSON.stringify([user]));
      localStorage.setItem("demo_tasks", JSON.stringify([]));
      localStorage.setItem("demo_session", JSON.stringify(user));
      localStorage.setItem("demo_break_mode", "none");
    });

    await page.goto(`${BASE_URL}/dashboard`);
    await use(page);
  },
});

export { expect } from "@playwright/test";
```

---

## Auth Tests (`tests/auth/login.spec.ts`)

```typescript
import { test, expect } from "../fixtures/base";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test.describe("Login", () => {
  test("should display login form", async ({ seededPage: page }) => {
    await page.goto(`${BASE_URL}/login`);
    await expect(page.getByTestId("email-input")).toBeVisible();
    await expect(page.getByTestId("password-input")).toBeVisible();
    await expect(page.getByTestId("submit-button")).toBeVisible();
  });

  test("should login with valid credentials", async ({ seededPage: page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByTestId("email-input").fill("test@example.com");
    await page.getByTestId("password-input").fill("password123");
    await page.getByTestId("submit-button").click();
    await expect(page).toHaveURL(`${BASE_URL}/dashboard`);
  });

  test("should show error for invalid credentials", async ({ seededPage: page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByTestId("email-input").fill("wrong@example.com");
    await page.getByTestId("password-input").fill("wrongpassword");
    await page.getByTestId("submit-button").click();
    await expect(page.getByTestId("error-message")).toBeVisible();
    await expect(page.getByTestId("error-message")).toContainText("Invalid credentials");
  });

  test("should redirect to dashboard if already logged in", async ({ loggedInPage: page }) => {
    await page.goto(`${BASE_URL}/login`);
    await expect(page).toHaveURL(`${BASE_URL}/dashboard`);
  });
});
```

---

## Auth Tests (`tests/auth/register.spec.ts`)

```typescript
import { test, expect } from "../fixtures/base";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test.describe("Register", () => {
  test("should register a new user", async ({ seededPage: page }) => {
    await page.goto(`${BASE_URL}/register`);
    await page.getByTestId("email-input").fill("newuser@example.com");
    await page.getByTestId("password-input").fill("securepass123");
    await page.getByTestId("displayname-input").fill("New User");
    await page.getByTestId("submit-button").click();
    await expect(page).toHaveURL(`${BASE_URL}/dashboard`);
  });

  test("should show error for duplicate email", async ({ seededPage: page }) => {
    await page.goto(`${BASE_URL}/register`);
    await page.getByTestId("email-input").fill("test@example.com"); // already exists
    await page.getByTestId("password-input").fill("password123");
    await page.getByTestId("displayname-input").fill("Duplicate User");
    await page.getByTestId("submit-button").click();
    await expect(page.getByTestId("error-message")).toBeVisible();
    await expect(page.getByTestId("error-message")).toContainText("already registered");
  });
});
```

---

## Task Tests (`tests/tasks/add-task.spec.ts`)

```typescript
import { test, expect } from "../fixtures/base";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test.describe("Add Task", () => {
  test("should add a new task", async ({ loggedInPage: page }) => {
    await page.getByTestId("task-input").fill("Buy groceries");
    await page.getByTestId("add-task-button").click();
    await expect(page.getByText("Buy groceries")).toBeVisible();
  });

  test("should not add empty task", async ({ loggedInPage: page }) => {
    await page.getByTestId("task-input").fill("");
    await page.getByTestId("add-task-button").click();
    // No new task item should appear
    const taskItems = page.locator("[data-testid^='task-item-']");
    await expect(taskItems).toHaveCount(0);
  });

  test("should clear input after adding task", async ({ loggedInPage: page }) => {
    await page.getByTestId("task-input").fill("Read a book");
    await page.getByTestId("add-task-button").click();
    await expect(page.getByTestId("task-input")).toHaveValue("");
  });

  test("should show task count after adding multiple tasks", async ({ loggedInPage: page }) => {
    await page.getByTestId("task-input").fill("Task 1");
    await page.getByTestId("add-task-button").click();
    await page.getByTestId("task-input").fill("Task 2");
    await page.getByTestId("add-task-button").click();
    await page.getByTestId("task-input").fill("Task 3");
    await page.getByTestId("add-task-button").click();

    const taskItems = page.locator("[data-testid^='task-item-']");
    await expect(taskItems).toHaveCount(3);
  });
});
```

---

## Task Tests (`tests/tasks/complete-task.spec.ts`)

```typescript
import { test, expect } from "../fixtures/base";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test.describe("Complete Task", () => {
  test.beforeEach(async ({ loggedInPage: page }) => {
    // Add a task to work with
    await page.getByTestId("task-input").fill("Test task to complete");
    await page.getByTestId("add-task-button").click();
  });

  test("should mark task as complete", async ({ loggedInPage: page }) => {
    const checkbox = page.locator("[data-testid^='task-checkbox-']").first();
    await checkbox.check();
    await expect(checkbox).toBeChecked();
  });

  test("should toggle task back to incomplete", async ({ loggedInPage: page }) => {
    const checkbox = page.locator("[data-testid^='task-checkbox-']").first();
    await checkbox.check();
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
  });
});
```

---

## Task Tests (`tests/tasks/delete-task.spec.ts`)

```typescript
import { test, expect } from "../fixtures/base";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test.describe("Delete Task", () => {
  test("should delete a task", async ({ loggedInPage: page }) => {
    await page.getByTestId("task-input").fill("Task to delete");
    await page.getByTestId("add-task-button").click();

    const deleteBtn = page.locator("[data-testid^='task-delete-']").first();
    await deleteBtn.click();

    const taskItems = page.locator("[data-testid^='task-item-']");
    await expect(taskItems).toHaveCount(0);
  });

  test("should only delete the targeted task", async ({ loggedInPage: page }) => {
    await page.getByTestId("task-input").fill("Keep this task");
    await page.getByTestId("add-task-button").click();
    await page.getByTestId("task-input").fill("Delete this task");
    await page.getByTestId("add-task-button").click();

    // Delete second task
    const deleteButtons = page.locator("[data-testid^='task-delete-']");
    await deleteButtons.nth(1).click();

    await expect(page.getByText("Keep this task")).toBeVisible();
    await expect(page.getByText("Delete this task")).not.toBeVisible();
  });
});
```

---

## Profile Tests (`tests/profile/profile.spec.ts`)

```typescript
import { test, expect } from "../fixtures/base";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test.describe("Profile", () => {
  test("should display user display name", async ({ loggedInPage: page }) => {
    await page.goto(`${BASE_URL}/profile`);
    await expect(page.getByTestId("profile-displayname")).toContainText("Test User");
  });

  test("should update display name", async ({ loggedInPage: page }) => {
    await page.goto(`${BASE_URL}/profile`);
    await page.getByTestId("displayname-edit-input").fill("Updated Name");
    await page.getByTestId("save-profile-button").click();
    await expect(page.getByTestId("profile-displayname")).toContainText("Updated Name");
  });
});
```

---

## GitHub Actions Workflow (`.github/workflows/playwright.yml`)

```yaml
name: Playwright + AI QA Agent

on:
  push:
    branches: [main, develop]
  pull_request:
  workflow_dispatch:             # manual trigger for demos
    inputs:
      break_mode:
        description: "Break mode to activate before tests"
        required: false
        default: "none"
        type: choice
        options:
          - none
          - selector-change
          - logic-bug
          - auth-break

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
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install chromium --with-deps

      - name: Run Playwright tests
        id: playwright
        env:
          BASE_URL: ${{ secrets.DEMO_APP_URL }}    # your Vercel URL
          BREAK_MODE: ${{ github.event.inputs.break_mode || 'none' }}
          CI: true
        run: npx playwright test
        continue-on-error: true    # CRITICAL: must not stop pipeline on failure

      - name: Upload test results
        if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v4
        with:
          name: playwright-results
          path: |
            test-results/
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

      - name: Fail pipeline if tests failed
        if: steps.playwright.outcome == 'failure'
        run: exit 1
```

The final `exit 1` step ensures the pipeline still shows as failed in GitHub (important for PR checks), even though `continue-on-error: true` was used to allow the agent to run.

---

## `package.json` Scripts

```json
{
  "scripts": {
    "test": "playwright test",
    "test:headed": "playwright test --headed",
    "test:debug": "playwright test --debug",
    "test:report": "playwright show-report test-results/html-report",
    "agent": "tsx agent/orchestrator.ts"
  }
}
```

---

## How to Trigger Each Agent Behavior Manually

For demos, use the `workflow_dispatch` manual trigger in GitHub Actions with a break mode:

1. Go to `Actions` tab in GitHub
2. Select `Playwright + AI QA Agent`
3. Click `Run workflow`
4. Choose a break mode from the dropdown

But since break mode is controlled by localStorage (client-side), you need to activate it via Playwright itself before the test run. Add a global setup file:

**`tests/global-setup.ts`**
```typescript
import { chromium } from "@playwright/test";

async function globalSetup() {
  const breakMode = process.env.BREAK_MODE ?? "none";
  if (breakMode === "none") return;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(process.env.BASE_URL ?? "http://localhost:3000");
  await page.evaluate((mode) => {
    localStorage.setItem("demo_break_mode", mode);
  }, breakMode);
  await browser.close();
}

export default globalSetup;
```

In `playwright.config.ts`:
```typescript
globalSetup: "./tests/global-setup.ts",
```

In the workflow:
```yaml
- name: Run Playwright tests
  env:
    BASE_URL: ${{ secrets.DEMO_APP_URL }}
    BREAK_MODE: ${{ github.event.inputs.break_mode || 'none' }}
    CI: true
  run: npx playwright test
  continue-on-error: true
```

---

## Required GitHub Secrets

| Secret | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `DEMO_APP_URL` | Vercel deployment URL (e.g. `https://taskflow-demo.vercel.app`) |
| `GITHUB_TOKEN` | Auto-provided by GitHub Actions |

---

## End-to-End Demo Script (for interviews/portfolio)

1. Show the live app URL → set break mode to `selector-change` via Dev Panel
2. Trigger `workflow_dispatch` with `break_mode: selector-change`
3. Show GitHub Actions running
4. Show the agent step running after test failure
5. Show the auto-generated PR with the healed test file
6. Reset to `logic-bug`, repeat → show GitHub Issue created automatically
7. Open `test-results/html-report` artifact → show Playwright's native failure report

This sequence demonstrates: test execution, AI classification, two distinct automated responses (PR vs Issue), and Playwright reporting — all in under 5 minutes.
