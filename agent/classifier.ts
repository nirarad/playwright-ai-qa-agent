import { getAgentConfig } from './config.js'
import { logger } from './logger.js'
import { getLlmClient } from './llm/factory.js'
import type {
  ClassificationResult,
  FailureCategory,
  FailureContext,
  OllamaPerformanceConfig,
} from './types.js'

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

const stripCodeFences = (value: string): string => {
  const trimmed = value.trim()
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (!fencedMatch) {
    return trimmed
  }
  return fencedMatch[1].trim()
}

const extractFirstJsonObject = (value: string): string => {
  const start = value.indexOf('{')
  if (start < 0) {
    return value
  }

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < value.length; index += 1) {
    const char = value[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return value.slice(start, index + 1)
      }
    }
  }

  return value
}

const normalizeJsonCandidate = (raw: string): string => {
  const withoutFences = stripCodeFences(raw)
  return extractFirstJsonObject(withoutFences).trim()
}

const hasExplicitLocatorResolutionSignal = (ctx: FailureContext): boolean => {
  const signalText = `${ctx.error}\n${ctx.errorStack}\n${ctx.playwrightErrorMessages ?? ''}\n${ctx.errorContext ?? ''}`.toLowerCase()
  const signatures = [
    'waiting for getbytestid(',
    'waiting for locator(',
    'strict mode violation',
    'locator.fill:',
    'locator.click:',
    'locator.check:',
    'locator is not visible',
    'element is not attached',
    'resolved to 0 elements',
    'did not match any elements',
  ]
  return signatures.some((signature) => signalText.includes(signature))
}

const truncateHeadForOllama = (value: string | undefined, maxChars: number): string | undefined => {
  if (value === undefined) {
    return undefined
  }
  if (value.length <= maxChars) {
    return value
  }
  const omitted = value.length - maxChars
  return `${value.slice(0, maxChars)}\n\n...[truncated ${omitted} chars for ollama performance]`
}

const narrowContextForOllama = (
  ctx: FailureContext,
  limits: OllamaPerformanceConfig,
): FailureContext => ({
  ...ctx,
  errorContext: truncateHeadForOllama(ctx.errorContext, limits.maxErrorContextChars),
  playwrightErrorMessages: truncateHeadForOllama(
    ctx.playwrightErrorMessages,
    limits.maxErrorContextChars,
  ),
  domSnapshot: truncateHeadForOllama(ctx.domSnapshot, limits.maxDomChars),
  testSource: truncateHeadForOllama(ctx.testSource, limits.maxTestSourceChars) ?? ctx.testSource,
})

const buildRepairPrompt = (rawResponse: string): string => {
  return `Convert the following model output into valid JSON.

Return JSON only. No markdown, no code fences, no prose.
Required schema:
{
  "category": "BROKEN_LOCATOR" | "REAL_BUG" | "FLAKY" | "ENV_ISSUE",
  "confidence": 0.0-1.0,
  "reason": "one sentence",
  "suggestedFix": "string or null"
}

Model output to repair:
${rawResponse}`
}

export const classifyFailure = async (ctx: FailureContext): Promise<ClassificationResult> => {
  const config = getAgentConfig()
  const llm = getLlmClient(config)

  if (hasExplicitLocatorResolutionSignal(ctx)) {
    logger.info('Applying deterministic locator-bias rule before LLM call', {
      testName: ctx.testName,
      reason: 'Explicit locator-resolution error signatures detected.',
    })
    return {
      category: 'BROKEN_LOCATOR',
      confidence: 0.93,
      reason: 'Explicit locator-resolution failure signature detected in error context.',
      suggestedFix:
        'Update stale locator targets (data-testid or selector strategy) to match current DOM.',
    }
  }

  const ctxForLlm =
    config.llm.provider === 'ollama'
      ? narrowContextForOllama(ctx, config.ollama)
      : ctx

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

Test name: ${ctxForLlm.testName}
Test file: ${ctxForLlm.testFile}
Error: ${ctxForLlm.error}
Stack:
${ctxForLlm.errorStack}
Additional Playwright error messages (from JSON errors[], if any):
${ctxForLlm.playwrightErrorMessages ?? '(none)'}
Error context markdown (if available):
${ctxForLlm.errorContext ?? '(none)'}
DOM snapshot HTML at failure time (if available):
${ctxForLlm.domSnapshot ?? '(none)'}

Test source:
${ctxForLlm.testSource}`

  logger.debug('Submitting classification request', {
    provider: config.llm.provider,
    model: config.llm.model,
    testName: ctx.testName,
    maxTokens: config.llm.maxTokens.classify,
    temperature: config.llm.temperature.classify,
    promptChars: prompt.length,
    hasStack: Boolean(ctxForLlm.errorStack),
    hasPlaywrightErrorMessages: Boolean(ctxForLlm.playwrightErrorMessages),
    hasErrorContext: Boolean(ctxForLlm.errorContext),
    hasDomSnapshot: Boolean(ctxForLlm.domSnapshot),
  })

  const raw = await llm.classifyFailure({
    prompt,
    maxTokens: config.llm.maxTokens.classify,
    temperature: config.llm.temperature.classify,
  })

  logger.debug('Received classification raw response', {
    provider: config.llm.provider,
    model: config.llm.model,
    responseChars: raw.length,
    rawResponse: raw,
  })

  const normalized = normalizeJsonCandidate(raw)
  logger.debug('Normalized classification response', {
    provider: config.llm.provider,
    model: config.llm.model,
    normalizedChars: normalized.length,
    normalizedResponse: normalized,
  })

  try {
    const parsed = JSON.parse(normalized) as unknown
    return assertClassificationResult(parsed)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('Primary classification parse failed, attempting response repair', {
      provider: config.llm.provider,
      model: config.llm.model,
      error: message,
    })

    const repairedRaw = await llm.classifyFailure({
      prompt: buildRepairPrompt(raw),
      maxTokens: config.llm.maxTokens.classify,
      temperature: 0,
    })
    const repairedNormalized = normalizeJsonCandidate(repairedRaw)

    logger.debug('Received repaired classification response', {
      provider: config.llm.provider,
      model: config.llm.model,
      responseChars: repairedRaw.length,
      rawResponse: repairedRaw,
      normalizedChars: repairedNormalized.length,
      normalizedResponse: repairedNormalized,
    })

    const parsed = JSON.parse(repairedNormalized) as unknown
    return assertClassificationResult(parsed)
  }
}
