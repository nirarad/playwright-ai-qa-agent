# Plan: AI Failure Detection & Bug Reporting Agent

## What This Builds

A GitHub Actions orchestrator that runs after Playwright tests fail. It reads failure context, calls Claude API to classify the failure, then either opens a PR with an auto-fix or creates a GitHub Issue — with zero external services.

---

## Repo Structure to Create

```
qa-ai-agent/
├── .github/
│   └── workflows/
│       └── playwright.yml          # CI pipeline (see plan-03)
├── agent/
│   ├── orchestrator.ts             # Main entry point
│   ├── classifier.ts               # Claude API: classify failure
│   ├── healer.ts                   # Claude API: generate fix + open PR
│   ├── reporter.ts                 # GitHub API: create Issue
│   ├── context.ts                  # Read failure artifacts from disk
│   └── types.ts                    # Shared types
├── reporters/
│   └── webhook-reporter.ts         # Playwright custom reporter
├── playwright.config.ts
├── package.json
└── tsconfig.json
```

---

## Types (`agent/types.ts`)

```typescript
export type FailureCategory =
  | "BROKEN_LOCATOR"
  | "REAL_BUG"
  | "FLAKY"
  | "ENV_ISSUE";

export interface FailureContext {
  testName: string;
  testFile: string;
  testSource: string;
  error: string;
  errorStack: string;
  screenshotPath?: string;
  screenshotBase64?: string;
  runUrl: string;
  branch: string;
  commit: string;
}

export interface ClassificationResult {
  category: FailureCategory;
  confidence: number;
  reason: string;
  suggestedFix: string | null;
}
```

---

## Context Extractor (`agent/context.ts`)

Reads the Playwright JSON results file and test source files from disk. Playwright writes results to `test-results/` when configured with the JSON reporter.

```typescript
import * as fs from "fs";
import * as path from "path";
import { FailureContext } from "./types";

export function extractFailures(): FailureContext[] {
  const resultsPath = "test-results/results.json";
  if (!fs.existsSync(resultsPath)) return [];

  const raw = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
  const failures: FailureContext[] = [];

  for (const suite of raw.suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          if (result.status !== "failed") continue;

          const testFile = spec.file;
          const testSource = fs.existsSync(testFile)
            ? fs.readFileSync(testFile, "utf-8")
            : "";

          const screenshot = result.attachments?.find(
            (a: any) => a.name === "screenshot" && a.path
          );
          let screenshotBase64: string | undefined;
          if (screenshot?.path && fs.existsSync(screenshot.path)) {
            screenshotBase64 = fs.readFileSync(screenshot.path).toString("base64");
          }

          failures.push({
            testName: spec.title,
            testFile,
            testSource,
            error: result.error?.message ?? "",
            errorStack: result.error?.stack ?? "",
            screenshotBase64,
            runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
            branch: process.env.GITHUB_REF_NAME ?? "",
            commit: process.env.GITHUB_SHA ?? "",
          });
        }
      }
    }
  }

  return failures;
}
```

---

## Classifier (`agent/classifier.ts`)

Calls Claude API. Returns structured JSON classification.

```typescript
import { FailureContext, ClassificationResult } from "./types";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";

export async function classifyFailure(
  ctx: FailureContext
): Promise<ClassificationResult> {
  const prompt = `You are a QA engineer analyzing a Playwright test failure.

Classify this failure into exactly one category:
- BROKEN_LOCATOR: selector/element not found, locator changed, element attributes changed
- REAL_BUG: app behavior differs from expected, assertion failure on business logic
- FLAKY: timing/race condition, intermittent network, order-dependent
- ENV_ISSUE: authentication, environment config, missing dependency, network timeout to external service

Respond ONLY with valid JSON. No explanation, no markdown.
{
  "category": "BROKEN_LOCATOR" | "REAL_BUG" | "FLAKY" | "ENV_ISSUE",
  "confidence": 0.0-1.0,
  "reason": "one sentence explaining why",
  "suggestedFix": "if BROKEN_LOCATOR: describe a new selector strategy. Otherwise null."
}

Test name: ${ctx.testName}
Test file: ${ctx.testFile}
Error: ${ctx.error}
Stack:
${ctx.errorStack}

Test source:
${ctx.testSource}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json();
  const text = data.content[0].text.trim();

  return JSON.parse(text);
}
```

---

## Healer (`agent/healer.ts`)

Called only for `BROKEN_LOCATOR` with `confidence >= 0.75`. Gets Claude to rewrite the test file, then opens a PR via GitHub API.

```typescript
import * as fs from "fs";
import { FailureContext, ClassificationResult } from "./types";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const REPO = process.env.GITHUB_REPOSITORY!; // "org/repo"

export async function healAndOpenPR(
  ctx: FailureContext,
  classification: ClassificationResult
): Promise<void> {
  // Step 1: Generate fix
  const fixPrompt = `You are a Playwright expert. A test has a broken locator. 
Return ONLY the complete fixed test file content — no explanation, no markdown fences, no preamble.

Test file: ${ctx.testFile}
Error: ${ctx.error}
Classification reason: ${classification.reason}
Suggested fix direction: ${classification.suggestedFix}

Current test source:
${ctx.testSource}`;

  const fixResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: fixPrompt }],
    }),
  });

  const fixData = await fixResponse.json();
  const fixedSource = fixData.content[0].text.trim();

  // Step 2: Get current file SHA (required by GitHub Contents API)
  const fileRes = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${ctx.testFile}`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } }
  );
  const fileData = await fileRes.json();
  const fileSha = fileData.sha;

  // Step 3: Create branch
  const branchName = `fix/auto-heal-${ctx.testName
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 40)}-${Date.now()}`;

  const refRes = await fetch(
    `https://api.github.com/repos/${REPO}/git/ref/heads/main`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } }
  );
  const refData = await refRes.json();
  const mainSha = refData.object.sha;

  await fetch(`https://api.github.com/repos/${REPO}/git/refs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: mainSha }),
  });

  // Step 4: Commit fixed file to new branch
  await fetch(
    `https://api.github.com/repos/${REPO}/contents/${ctx.testFile}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: `fix(tests): auto-heal broken locator in "${ctx.testName}"`,
        content: Buffer.from(fixedSource).toString("base64"),
        sha: fileSha,
        branch: branchName,
      }),
    }
  );

  // Step 5: Open PR
  await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      title: `fix(tests): auto-heal: ${ctx.testName}`,
      body: `## Auto-Generated Heal PR\n\n**Failure:** ${ctx.error}\n**Reason:** ${classification.reason}\n**Confidence:** ${classification.confidence}\n**CI Run:** ${ctx.runUrl}\n\n> Review before merging — verify the fix is correct.`,
      head: branchName,
      base: "main",
    }),
  });

  console.log(`✅ Heal PR opened: ${branchName}`);
}
```

---

## Reporter (`agent/reporter.ts`)

Called for `REAL_BUG`. Creates a GitHub Issue with full context.

```typescript
import { FailureContext, ClassificationResult } from "./types";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const REPO = process.env.GITHUB_REPOSITORY!;

export async function createBugIssue(
  ctx: FailureContext,
  classification: ClassificationResult
): Promise<void> {
  const body = `## Automated Bug Report

**Detected by:** Playwright QA Agent  
**Branch:** \`${ctx.branch}\`  
**Commit:** \`${ctx.commit}\`  
**CI Run:** ${ctx.runUrl}  

---

## Error
\`\`\`
${ctx.error}
\`\`\`

## Stack Trace
\`\`\`
${ctx.errorStack}
\`\`\`

## Classification
| Field | Value |
|---|---|
| Category | ${classification.category} |
| Confidence | ${classification.confidence} |
| Reason | ${classification.reason} |

## Failing Test
**File:** \`${ctx.testFile}\`  
**Test:** ${ctx.testName}

---
*Auto-generated. Verify before acting on this issue.*`;

  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      title: `[BUG] ${ctx.testName} — ${classification.reason}`,
      body,
      labels: ["bug", "automated-qa"],
    }),
  });

  const data = await res.json();
  console.log(`🐛 Bug issue created: ${data.html_url}`);
}
```

---

## Orchestrator (`agent/orchestrator.ts`)

Entry point. Wires everything together.

```typescript
import { extractFailures } from "./context";
import { classifyFailure } from "./classifier";
import { healAndOpenPR } from "./healer";
import { createBugIssue } from "./reporter";

const CONFIDENCE_THRESHOLD = 0.75;

async function main() {
  const failures = extractFailures();

  if (failures.length === 0) {
    return;
  }

  console.log(`Found ${failures.length} failure(s). Processing...`);

  for (const failure of failures) {
    const classification = await classifyFailure(failure);

    if (classification.confidence < CONFIDENCE_THRESHOLD) {
      continue;
    }

    switch (classification.category) {
      case "BROKEN_LOCATOR":
        await healAndOpenPR(failure, classification);
        break;

      case "REAL_BUG":
        await createBugIssue(failure, classification);
        break;

      case "FLAKY":
        break;

      case "ENV_ISSUE":
        break;
    }
  }
}

main().catch((err) => {
  process.exit(1);
});
```

---

## package.json (relevant parts)

```json
{
  "scripts": {
    "agent": "tsx agent/orchestrator.ts"
  },
  "devDependencies": {
    "@playwright/test": "^1.44.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

---

## GitHub Actions Integration

In your Playwright workflow, add this step **after** the test run step:

```yaml
- name: Run AI Failure Agent
  if: failure()
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: npm run agent
```

The `if: failure()` condition ensures the agent only runs when tests fail.

---

## Required GitHub Secrets

Add these in `Settings > Secrets and variables > Actions`:

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `GITHUB_TOKEN` | Auto-provided by GitHub Actions — no action needed |

---

## Playwright Config Requirements

In `playwright.config.ts`, ensure these are set:

```typescript
reporter: [
  ["list"],
  ["json", { outputFile: "test-results/results.json" }],
],
use: {
  screenshot: "only-on-failure",
  trace: "on-first-retry",
},
```

---

## Cost Management

Each failure triggers 1–2 Claude API calls (~1,500–3,000 tokens total).  
At Sonnet pricing this is negligible for a demo project.  
The `CONFIDENCE_THRESHOLD = 0.75` guard prevents low-confidence actions from firing.

To further limit costs during development, add this to `orchestrator.ts`:

```typescript
// Limit to first 3 failures per run during development
const failures = extractFailures().slice(0, 3);
```

---

## What This Does NOT Handle (Known Limitations)

- Page Object Model files: the healer only reads and rewrites the failing test file. If your locators live in a POM, extend `context.ts` to also read imported POM files and include them in the Claude prompt.
- Screenshot attachment to GitHub Issues: GitHub Issues API does not accept binary uploads. To attach screenshots, upload to a GitHub Gist first, then embed the URL in the issue body.
- The healer does not re-run tests after the fix to verify correctness. This is intentional — always require human PR review before merging.
