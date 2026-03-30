import { getAgentConfig } from './config.js'
import { getLlmClient } from './llm/factory.js'
import type { ClassificationResult, FailureCategory, FailureContext } from './types.js'

const isFailureCategory = (value: unknown): value is FailureCategory => {
  return (
    value === 'BROKEN_LOCATOR' ||
    value === 'REAL_BUG' ||
    value === 'FLAKY' ||
    value === 'ENV_ISSUE'
  )
}

export const assertClassificationResult = (value: unknown): ClassificationResult => {
  if (!value || typeof value !== 'object') {
    throw new Error('Classification output must be an object')
  }

  const candidate = value as Partial<ClassificationResult>
  if (!isFailureCategory(candidate.category)) {
    throw new Error('Classification output has invalid category')
  }
  if (typeof candidate.confidence !== 'number') {
    throw new Error('Classification output confidence must be a number')
  }
  if (candidate.confidence < 0 || candidate.confidence > 1) {
    throw new Error('Classification output confidence must be between 0 and 1')
  }
  if (typeof candidate.reason !== 'string' || candidate.reason.length === 0) {
    throw new Error('Classification output reason must be a non-empty string')
  }
  if (typeof candidate.suggestedFix !== 'string' && candidate.suggestedFix !== null) {
    throw new Error('Classification output suggestedFix must be string or null')
  }

  return candidate as ClassificationResult
}

export const classifyFailure = async (ctx: FailureContext): Promise<ClassificationResult> => {
  const config = getAgentConfig()
  const llm = getLlmClient(config)

  const prompt = `You are a QA engineer analyzing a Playwright test failure.

Treat the failing test as the source of truth for requirements:
- Infer expected behavior from test steps and assertions in "Test source".
- Use assertion error text (Expected vs Received) as strongest mismatch signal.
- Do not invent product requirements beyond what test implies.

Classify into exactly one category:
- BROKEN_LOCATOR
- REAL_BUG
- FLAKY
- ENV_ISSUE

Respond with valid JSON only:
{
  "category": "BROKEN_LOCATOR" | "REAL_BUG" | "FLAKY" | "ENV_ISSUE",
  "confidence": 0.0-1.0,
  "reason": "one sentence",
  "suggestedFix": "string or null"
}

Test name: ${ctx.testName}
Test file: ${ctx.testFile}
Error: ${ctx.error}
Stack:
${ctx.errorStack}

Test source:
${ctx.testSource}`

  const raw = await llm.classifyFailure({
    prompt,
    maxTokens: config.llm.maxTokens.classify,
    temperature: config.llm.temperature.classify,
  })

  const parsed = JSON.parse(raw) as unknown
  return assertClassificationResult(parsed)
}
