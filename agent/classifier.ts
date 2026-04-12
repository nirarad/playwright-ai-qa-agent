import { getAgentConfig } from './config.js'
import { logger } from './logger.js'
import { getLlmClient } from './llm/factory.js'
import type { LlmClient } from './llm/types.js'
import type {
  AgentConfig,
  ClassificationContextLimits,
  ClassificationResult,
  FailureCategory,
  FailureContext,
} from './types.js'

const RULE_BASED_BROKEN_LOCATOR_CONFIDENCE = 0.93

const LOCATOR_RULE_EXPLANATION_ONLY_HINT = `Deterministic rule (non-negotiable): Playwright reported locator-resolution failure, so the failure category is fixed as BROKEN_LOCATOR. Your JSON "category" and "confidence" will be ignored; output valid JSON with the usual schema anyway. Write "reason" and "suggestedFix" as if the category were BROKEN_LOCATOR (stale selectors, renamed data-testid, DOM drift).`

const RULE_BROKEN_LOCATOR_FALLBACK_REASON =
  'Explicit locator-resolution failure signature detected; LLM explanation unavailable.'

const RULE_BROKEN_LOCATOR_FALLBACK_SUGGESTED_FIX =
  'Update stale locator targets (data-testid or selector strategy) to match current DOM.'

const buildFallbackIssueTitle = (
  ctx: FailureContext,
  category: FailureCategory,
): string => {
  const testNamePart = ctx.testName.replace(/\s+/g, ' ').trim()

  const summaryByCategory: Record<FailureCategory, string> = {
    BROKEN_LOCATOR: 'element not found by locator',
    REAL_BUG: 'expected UI state not reached',
    FLAKY: 'timing mismatch',
    ENV_ISSUE: 'connection refused',
  }

  const summary = summaryByCategory[category]
  // Keep under ~70 chars: `<test>: <summary>`
  const maxTotal = 70
  const maxTest = Math.max(10, maxTotal - summary.length - 3)
  const testShort = testNamePart.length <= maxTest
    ? testNamePart
    : `${testNamePart.slice(0, maxTest).trim()}...`

  return `${testShort}: ${summary}`.replace(/\u2014/g, ':')
}

const extractLocatorSignal = (ctx: FailureContext): string | null => {
  const combined = `${ctx.error}\n${ctx.errorStack}\n${ctx.playwrightErrorMessages ?? ''}`
  const locatorLine = combined.match(/Locator:\s*([^\n\r]+)/i)
  if (locatorLine?.[1]) {
    return locatorLine[1].trim()
  }
  const waitingFor = combined.match(/waiting for\s+([^\n\r]+)/i)
  if (waitingFor?.[1]) {
    return waitingFor[1].trim()
  }
  return null
}

const extractLocatorToken = (value: string): string | null => {
  const quoted = value.match(/['"]([^'"]+)['"]/)
  if (quoted?.[1]) {
    return quoted[1].trim()
  }
  const idLike = value.match(/[A-Za-z_$][A-Za-z0-9_$]*/)
  return idLike?.[0] ?? null
}

const extractDomTestIds = (
  domSnapshot: string | undefined,
): Array<{ tag: string; testId: string }> => {
  if (!domSnapshot) {
    return []
  }
  const matches = Array.from(
    domSnapshot.matchAll(
      /<([a-zA-Z0-9-]+)[^>]*\sdata-testid=(?:"([^"]+)"|'([^']+)')[^>]*>/g,
    ),
  )
  return matches
    .map((match) => ({
      tag: (match[1] ?? '').toLowerCase(),
      testId: (match[2] ?? match[3] ?? '').trim(),
    }))
    .filter((entry) => entry.tag.length > 0 && entry.testId.length > 0)
}

const stripVersionSuffix = (value: string): string => {
  return value.replace(/-v\d+$/i, '')
}

const inferLocatorOperation = (ctx: FailureContext): 'fill' | 'click' | 'check' | 'other' => {
  const text =
    `${ctx.error}\n${ctx.errorStack}\n${ctx.playwrightErrorMessages ?? ''}`.toLowerCase()
  if (text.includes('locator.fill')) {
    return 'fill'
  }
  if (text.includes('locator.click')) {
    return 'click'
  }
  if (text.includes('locator.check')) {
    return 'check'
  }
  return 'other'
}

const inferExpectedTag = (ctx: FailureContext): string | null => {
  const operation = inferLocatorOperation(ctx)
  if (operation === 'fill') {
    return 'input'
  }
  if (operation === 'check') {
    return 'input'
  }
  if (operation === 'click') {
    return 'button'
  }
  return null
}

const pickStrictLocatorReplacement = (
  ctx: FailureContext,
  originalLocator: string | null,
): { original: string; proposed: string; tag: string | null } | null => {
  if (!originalLocator) {
    return null
  }
  const domTestIds = extractDomTestIds(ctx.domSnapshot)
  const expectedTag = inferExpectedTag(ctx)
  const normalizedOriginal = stripVersionSuffix(originalLocator)
  const candidates = domTestIds.filter((entry) => {
    if (entry.testId === originalLocator) {
      return false
    }
    if (stripVersionSuffix(entry.testId) !== normalizedOriginal) {
      return false
    }
    if (expectedTag && entry.tag !== expectedTag) {
      return false
    }
    return true
  })
  if (candidates.length === 0) {
    return null
  }
  const best = candidates[0]
  return {
    original: originalLocator,
    proposed: best.testId,
    tag: best.tag,
  }
}

const buildStrictBrokenLocatorSuggestion = (
  ctx: FailureContext,
  llmSuggestedFix: string | null | undefined,
): string => {
  const locatorSignal = extractLocatorSignal(ctx) ?? ''
  const originalLocator = extractLocatorToken(locatorSignal)
  const strict = pickStrictLocatorReplacement(ctx, originalLocator)
  if (strict) {
    return `Update only data-testid '${strict.original}' to '${strict.proposed}' (element: ${strict.tag ?? 'unknown'}). Do not modify any other locator.`
  }
  if (originalLocator) {
    return `Update only locator '${originalLocator}' to the current DOM value for the same element type. Do not modify any other locator.`
  }
  if (llmSuggestedFix && llmSuggestedFix.trim() !== '') {
    return llmSuggestedFix
  }
  return RULE_BROKEN_LOCATOR_FALLBACK_SUGGESTED_FIX
}

const buildBrokenLocatorIssueTitle = (
  ctx: FailureContext,
  llmIssueTitle: string | null | undefined,
  suggestedFix: string | null | undefined,
): string => {
  const locatorSignal = extractLocatorSignal(ctx) ?? ''
  const fromError = extractLocatorToken(locatorSignal)
  const fromFix = extractLocatorToken(suggestedFix ?? '')
  const locator = fromFix ?? fromError
  const testNamePart = ctx.testName.replace(/\s+/g, ' ').trim()
  const source = (llmIssueTitle ?? '').replace(/\u2014/g, ':').trim()
  if (source && locator && source.toLowerCase().includes(locator.toLowerCase())) {
    return source
  }
  if (locator) {
    const raw = `${testNamePart}: broken locator '${locator}'`
    return raw.length <= 70 ? raw : `${raw.slice(0, 67)}...`
  }
  if (source) {
    return source
  }
  return buildFallbackIssueTitle(ctx, 'BROKEN_LOCATOR')
}

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
  if (typeof candidate.issueTitle !== 'string' || candidate.issueTitle.length === 0) {
    throw new Error('Classification output issueTitle must be a non-empty string')
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

/**
 * When the LLM returns BROKEN_LOCATOR for getByText + not visible, but the test
 * source shows the same user-visible string was passed into an action (addTask,
 * fill, etc.) and then asserted via getByText, treat as REAL_BUG: missing wrong
 * rendered content, not an obsolete automation selector. Uses only FailureContext
 * strings (no QA_MODE).
 */
export const shouldOverrideBrokenLocatorToRealBug = (ctx: FailureContext): boolean => {
  const combined = `${ctx.error}\n${ctx.errorStack}\n${ctx.playwrightErrorMessages ?? ''}\n${ctx.errorContext ?? ''}`
  const lower = combined.toLowerCase()
  if (!lower.includes('getbytext')) {
    return false
  }
  if (
    !(
      lower.includes('tobevisible') ||
      lower.includes('element(s) not found') ||
      lower.includes('timeout') ||
      lower.includes('not found')
    )
  ) {
    return false
  }

  const literals: string[] = []
  const re = /getByText\s*\(\s*['"]([^'"]+)['"]\s*\)/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(combined)) !== null) {
    const lit = match[1]?.trim()
    if (lit && lit.length >= 1) {
      literals.push(lit)
    }
  }
  if (literals.length === 0) {
    return false
  }

  const src = ctx.testSource
  for (const lit of literals) {
    const escaped = lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const actionPattern = new RegExp(
      `(?:addTask|fill|type|pressSequentially)\\s*\\(\\s*['"]${escaped}['"]`,
    )
    if (actionPattern.test(src)) {
      return true
    }
  }
  return false
}

const applyBrokenLocatorToRealBugOverride = (
  ctx: FailureContext,
  parsed: ClassificationResult,
): ClassificationResult => {
  const confidence = Math.max(parsed.confidence, 0.85)
  logger.info('Classification override: action literal + getByText visibility miss → REAL_BUG', {
    testName: ctx.testName,
    modelCategory: parsed.category,
  })
  return {
    category: 'REAL_BUG',
    confidence,
    reason:
      'Test supplied this text via an action then asserted the same visible string; missing text indicates wrong or missing app content (REAL_BUG), not an obsolete selector alone.',
    issueTitle: buildFallbackIssueTitle(ctx, 'REAL_BUG'),
    suggestedFix: null,
  }
}

const hasExplicitLocatorResolutionSignal = (ctx: FailureContext): boolean => {
  const signalText = `${ctx.error}\n${ctx.errorStack}\n${ctx.playwrightErrorMessages ?? ''}\n${ctx.errorContext ?? ''}`.toLowerCase()
  const hasExpectedReceivedMismatch =
    signalText.includes('expected:') && signalText.includes('received:')

  // If the failure is an assertion mismatch, we should let the LLM decide.
  // A real app bug often presents as "element not found" after an action.
  if (hasExpectedReceivedMismatch) {
    return false
  }

  // If the locator is getByText(), missing content can be REAL_BUG (logic bug)
  // as often as it can be a broken selector. Do not lock the category.
  if (signalText.includes('waiting for getbytext(')) {
    return false
  }

  // Only lock BROKEN_LOCATOR on strong selector-resolution signatures.
  const strongSignatures = [
    'strict mode violation',
    'waiting for getbytestid(',
    "waiting for locator('[data-testid",
    "waiting for locator(\"[data-testid",
    "waiting for locator('[aria-",
    "waiting for locator(\"[aria-",
    "waiting for locator('[role=",
    "waiting for locator(\"[role=",
    "waiting for locator('#",
    'waiting for locator("#',
    "waiting for locator('.",
    'waiting for locator(".',
    'did not match any elements',
    'resolved to 0 elements',
    'locator.click:',
    'locator.fill:',
    'locator.check:',
  ]

  return strongSignatures.some((signature) => signalText.includes(signature))
}

const truncateClassificationField = (
  value: string | undefined,
  maxChars: number,
): string | undefined => {
  if (value === undefined) {
    return undefined
  }
  if (value.length <= maxChars) {
    return value
  }
  const omitted = value.length - maxChars
  return `${value.slice(0, maxChars)}\n\n...[truncated ${omitted} chars; classification context limit]`
}

/** Trims large optional fields before sending failure context to any LLM provider. */
export const narrowClassificationContext = (
  ctx: FailureContext,
  limits: ClassificationContextLimits,
): FailureContext => ({
  ...ctx,
  errorContext: truncateClassificationField(ctx.errorContext, limits.maxErrorContextChars),
  playwrightErrorMessages: truncateClassificationField(
    ctx.playwrightErrorMessages,
    limits.maxErrorContextChars,
  ),
  domSnapshot: truncateClassificationField(ctx.domSnapshot, limits.maxDomChars),
  testSource:
    truncateClassificationField(ctx.testSource, limits.maxTestSourceChars) ?? ctx.testSource,
})

const buildRepairPrompt = (rawResponse: string): string => {
  return `Convert the following model output into valid JSON.

Return JSON only. No markdown, no code fences, no prose.
Required schema:
{
  "category": "BROKEN_LOCATOR" | "REAL_BUG" | "FLAKY" | "ENV_ISSUE",
  "confidence": 0.0-1.0,
  "reason": "one sentence",
  "issueTitle": "short direct title fragment using ':' (<= 70 chars; no em-dash; do not include [BUG]/[ENV] prefix)",
  "suggestedFix": "string or null"
}

Model output to repair:
${rawResponse}`
}

export const buildClassificationPrompt = (
  ctxForLlm: FailureContext,
  locatorRuleExplanationOnly: boolean,
): string => {
  const ruleLead = locatorRuleExplanationOnly
    ? `${LOCATOR_RULE_EXPLANATION_ONLY_HINT}\n\n`
    : ''
  return `${ruleLead}You are a QA engineer analyzing a Playwright test failure.

Base your classification only on the artifacts below (error text, stacks, Playwright call logs, error-context, DOM snapshot, test source). Do not assume hidden test harness flags or how the app was configured for the run.

Reason in this order:
1) Assertion shape: If the failure includes Expected vs Received (counts, text, strict mode, or visibility timeout vs missing content), treat that as primary evidence. Count or state mismatches after the locator resolved usually indicate REAL_BUG (wrong app outcome), not automation selector drift.
2) Call logs / errors[]: Use "waiting for …", "resolved to N elements", timeouts. Distinguish "selector matches nothing in the tree" from "selector matched but assertion failed" or "wrong visible text/state".
3) Test source: Compare literals the test passes into actions (titles typed, labels, page object calls) with what the failing assertion expects. If the same literal appears in an action and in getByText/expect but the UI did not show that text, prefer REAL_BUG unless the DOM snapshot or error-context proves the automation contract changed (e.g. renamed data-testid only).
4) DOM snapshot / error-context: Decide whether missing expected text is due to wrong/missing data (REAL_BUG) vs missing element or obsolete selector (BROKEN_LOCATOR).

Category definitions:
- BROKEN_LOCATOR: The automation target no longer matches the current DOM contract (wrong/obsolete data-testid, role, or selector; element not in the document when the product structure should still expose it). The app behavior may be fine; the test aims at the wrong node.
- REAL_BUG: The test expectation matches the intended product behavior, but the application produced the wrong or missing user-visible outcome after actions (including getByText/toBeVisible timeouts when the test had just supplied that string via an action or page object). Assertion diffs (Expected/Received) pointing at wrong counts or state strongly support REAL_BUG.
- FLAKY: Non-deterministic timing/order when the same test would pass on retry without code changes.
- ENV_ISSUE: Environment or infrastructure (network, missing secret, wrong base URL, service down).

Respond with valid JSON only:
{
  "category": "BROKEN_LOCATOR" | "REAL_BUG" | "FLAKY" | "ENV_ISSUE",
  "confidence": 0.0-1.0,
  "reason": "one sentence",
  "issueTitle": "short direct title fragment using ':' (<= 70 chars; no em-dash; do not include [BUG]/[ENV] prefix)",
  "suggestedFix": "string or null"
}

For BROKEN_LOCATOR specifically:
- suggestedFix must target exactly one locator.
- Use this format when possible: Update only data-testid '<old>' to '<new>' (element: <input|button|label|link|other>). Do not modify any other locator.
- Never suggest multiple locator options in one suggestedFix.
- For REAL_BUG, suggestedFix is usually null unless you have a minimal product fix unrelated to locator renames.

Test name: ${ctxForLlm.testName}
Test file: ${ctxForLlm.testFile}
Error (primary message from Playwright):
${ctxForLlm.error}
Stack:
${ctxForLlm.errorStack}
Additional Playwright error messages (from JSON errors[], call logs):
${ctxForLlm.playwrightErrorMessages ?? '(none)'}
Error context markdown (if available):
${ctxForLlm.errorContext ?? '(none)'}
DOM snapshot HTML at failure time (if available):
${ctxForLlm.domSnapshot ?? '(none)'}

Test source:
${ctxForLlm.testSource}`
}

const parseClassificationWithRepair = async (
  llm: LlmClient,
  config: AgentConfig,
  raw: string,
): Promise<ClassificationResult> => {
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

export const classifyFailure = async (ctx: FailureContext): Promise<ClassificationResult> => {
  const config = getAgentConfig()
  const llm = getLlmClient(config)

  const locatorRuleExplanationOnly = hasExplicitLocatorResolutionSignal(ctx)
  if (locatorRuleExplanationOnly) {
    logger.info('Locator rule locks category to BROKEN_LOCATOR; LLM supplies explanation only', {
      testName: ctx.testName,
    })
  }

  const ctxForLlm = narrowClassificationContext(ctx, config.classificationContext)

  const prompt = buildClassificationPrompt(ctxForLlm, locatorRuleExplanationOnly)

  logger.debug('Submitting classification request', {
    provider: config.llm.provider,
    model: config.llm.model,
    testName: ctx.testName,
    maxTokens: config.llm.maxTokens.classify,
    temperature: config.llm.temperature.classify,
    promptChars: prompt.length,
    locatorRuleExplanationOnly,
    hasStack: Boolean(ctxForLlm.errorStack),
    hasPlaywrightErrorMessages: Boolean(ctxForLlm.playwrightErrorMessages),
    hasErrorContext: Boolean(ctxForLlm.errorContext),
    hasDomSnapshot: Boolean(ctxForLlm.domSnapshot),
  })

  try {
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

    const parsed = await parseClassificationWithRepair(llm, config, raw)

    if (locatorRuleExplanationOnly) {
      const strictSuggestedFix = buildStrictBrokenLocatorSuggestion(
        ctx,
        parsed.suggestedFix,
      )
      return {
        category: 'BROKEN_LOCATOR',
        confidence: RULE_BASED_BROKEN_LOCATOR_CONFIDENCE,
        reason: parsed.reason,
        issueTitle: buildBrokenLocatorIssueTitle(
          ctx,
          parsed.issueTitle,
          strictSuggestedFix,
        ),
        suggestedFix: strictSuggestedFix,
      }
    }

    if (
      parsed.category === 'BROKEN_LOCATOR' &&
      shouldOverrideBrokenLocatorToRealBug(ctx)
    ) {
      return applyBrokenLocatorToRealBugOverride(ctx, parsed)
    }

    if (parsed.category !== 'BROKEN_LOCATOR') {
      return parsed
    }

    const strictSuggestedFix = buildStrictBrokenLocatorSuggestion(
      ctx,
      parsed.suggestedFix,
    )

    return {
      ...parsed,
      issueTitle: buildBrokenLocatorIssueTitle(
        ctx,
        parsed.issueTitle,
        strictSuggestedFix,
      ),
      suggestedFix: strictSuggestedFix,
    }
  } catch (error) {
    if (!locatorRuleExplanationOnly) {
      throw error
    }

    const message = error instanceof Error ? error.message : String(error)
    logger.warn('LLM explanation failed for rule-based BROKEN_LOCATOR; using fallback text', {
      testName: ctx.testName,
      error: message,
    })

    const strictFallbackSuggestion = buildStrictBrokenLocatorSuggestion(
      ctx,
      RULE_BROKEN_LOCATOR_FALLBACK_SUGGESTED_FIX,
    )

    return {
      category: 'BROKEN_LOCATOR',
      confidence: RULE_BASED_BROKEN_LOCATOR_CONFIDENCE,
      reason: RULE_BROKEN_LOCATOR_FALLBACK_REASON,
      suggestedFix: strictFallbackSuggestion,
      issueTitle: buildBrokenLocatorIssueTitle(
        ctx,
        null,
        strictFallbackSuggestion,
      ),
    }
  }
}
