# Plan: AI Failure Detection & Bug Reporting Agent (LLM-Agnostic)

## What This Builds

A GitHub Actions orchestrator that runs after Playwright tests fail. It reads
failure context, calls a configurable LLM provider to classify the failure,
then either opens a PR with an auto-fix or creates a GitHub Issue.

Provider/model behavior must be configured in a dedicated agent config file,
not hardcoded in classifier/healer modules.

---

## Repo Structure to Create

```
qa-ai-agent/
├── .github/
│   └── workflows/
│       └── playwright.yml          # CI pipeline (see plan-03)
├── agent/
│   ├── config.ts                   # Single source of truth for agent config
│   ├── llm/
│   │   ├── types.ts                # Provider-agnostic LLM interfaces
│   │   ├── factory.ts              # Build provider client from config
│   │   ├── anthropic-client.ts     # Optional provider adapter
│   │   ├── openai-client.ts        # Optional provider adapter
│   │   └── google-client.ts        # Optional provider adapter
│   ├── orchestrator.ts             # Main entry point
│   ├── classifier.ts               # Provider-agnostic: classify failure
│   ├── healer.ts                   # Provider-agnostic: generate fix + open PR
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

## Configuration-First Design (`agent/config.ts`)

All runtime behavior must be controlled by a typed config module. This avoids
provider lock-in and keeps workflow/runtime settings centralized.

Planned config surface:

```typescript
export interface AgentConfig {
  llm: {
    provider: 'anthropic' | 'openai' | 'google'
    model: string
    apiKeyEnvVar: string
    baseUrl?: string
    maxTokens: {
      classify: number
      heal: number
    }
    temperature: {
      classify: number
      heal: number
    }
  }
  thresholds: {
    confidence: number
  }
  limits: {
    maxFailuresPerRun: number
  }
  actions: {
    enableHealPr: boolean
    enableBugIssue: boolean
  }
  github: {
    baseBranch: string
  }
  paths: {
    resultsJson: string
  }
}
```

Configuration sources (precedence):

1. Hard defaults in `config.ts`
2. Environment overrides (CI/local)
3. Optional JSON file override (for demo switches)

No provider/model/token values should appear directly in classifier/healer.

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

## LLM Client Abstraction (`agent/llm/*`)

Introduce a provider-agnostic interface:

```typescript
export interface LlmClient {
  classifyFailure(input: {
    prompt: string
    maxTokens: number
    temperature: number
  }): Promise<string>
  generateFix(input: {
    prompt: string
    maxTokens: number
    temperature: number
  }): Promise<string>
}
```

Factory behavior:

- Read `config.llm.provider`
- Instantiate the matching adapter (`anthropic`, `openai`, or `google`)
- Validate required API key env var from config
- Throw explicit startup error for unsupported provider values

---

## Classifier (`agent/classifier.ts`)

Calls the provider-agnostic `LlmClient`. Returns structured JSON classification.

```typescript
import { FailureContext, ClassificationResult } from "./types";
import { getAgentConfig } from "./config";
import { getLlmClient } from "./llm/factory";

export async function classifyFailure(
  ctx: FailureContext
): Promise<ClassificationResult> {
  const config = getAgentConfig();
  const llm = getLlmClient(config);

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

  const raw = await llm.classifyFailure({
    prompt,
    maxTokens: config.llm.maxTokens.classify,
    temperature: config.llm.temperature.classify,
  });
  return JSON.parse(raw);
}
```

---

## Healer (`agent/healer.ts`)

Called only for `BROKEN_LOCATOR` with confidence above configured threshold.
Uses the same provider-agnostic `LlmClient` to rewrite the test file, then
opens a PR via GitHub API.

```typescript
import * as fs from "fs";
import { FailureContext, ClassificationResult } from "./types";
import { getAgentConfig } from "./config";
import { getLlmClient } from "./llm/factory";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const REPO = process.env.GITHUB_REPOSITORY!; // "org/repo"

export async function healAndOpenPR(
  ctx: FailureContext,
  classification: ClassificationResult
): Promise<void> {
  const config = getAgentConfig();
  const llm = getLlmClient(config);

  // Step 1: Generate fix
  const fixPrompt = `You are a Playwright expert. A test has a broken locator. 
Return ONLY the complete fixed test file content — no explanation, no markdown fences, no preamble.

Test file: ${ctx.testFile}
Error: ${ctx.error}
Classification reason: ${classification.reason}
Suggested fix direction: ${classification.suggestedFix}

Current test source:
${ctx.testSource}`;

  const fixedSource = await llm.generateFix({
    prompt: fixPrompt,
    maxTokens: config.llm.maxTokens.heal,
    temperature: config.llm.temperature.heal,
  });

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
      base: config.github.baseBranch,
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
import { getAgentConfig } from "./config";

async function main() {
  const config = getAgentConfig();
  const failures = extractFailures().slice(0, config.limits.maxFailuresPerRun);

  if (failures.length === 0) {
    return;
  }

  console.log(`Found ${failures.length} failure(s). Processing...`);

  for (const failure of failures) {
    const classification = await classifyFailure(failure);

    if (classification.confidence < config.thresholds.confidence) {
      continue;
    }

    switch (classification.category) {
      case "BROKEN_LOCATOR":
        if (config.actions.enableHealPr) {
          await healAndOpenPR(failure, classification);
        }
        break;

      case "REAL_BUG":
        if (config.actions.enableBugIssue) {
          await createBugIssue(failure, classification);
        }
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
    # Pick one provider key based on agent config
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
    AI_PROVIDER: anthropic
    AI_MODEL: claude-sonnet-4-20250514
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: npm run agent
```

The `if: failure()` condition ensures the agent only runs when tests fail.

---

## Required GitHub Secrets

Add these in `Settings > Secrets and variables > Actions`:

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key (if provider is anthropic) |
| `OPENAI_API_KEY` | OpenAI API key (if provider is openai) |
| `GOOGLE_API_KEY` | Google API key (if provider is google) |
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

Each failure triggers 1–2 LLM calls (~1,500–3,000 tokens total depending on
prompt size/model). Configure limits and model choice in `agent/config.ts`.

Use config gates to control spend:

- `thresholds.confidence`
- `limits.maxFailuresPerRun`
- lower-cost model selection per provider
- disabling heal PR action in early rollout

To further limit costs during development, set:

```typescript
limits: {
  maxFailuresPerRun: 3,
}
```

---

## What This Does NOT Handle (Known Limitations)

- Page Object Model files: the healer only reads and rewrites the failing
  test file. If locators live in a POM, extend `context.ts` to also read
  imported POM files and include them in the LLM prompt.
- Screenshot attachment to GitHub Issues: GitHub Issues API does not accept binary uploads. To attach screenshots, upload to a GitHub Gist first, then embed the URL in the issue body.
- The healer does not re-run tests after the fix to verify correctness. This is intentional — always require human PR review before merging.
