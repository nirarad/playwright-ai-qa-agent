import { classifyFailure } from './classifier.js'
import { getAgentConfig } from './config.js'
import { extractFailures } from './context.js'
import { loadEnvForAgent } from './env.js'
import { logger } from './logger.js'

const sleep = async (durationMs: number): Promise<void> => {
  if (durationMs <= 0) {
    return
  }
  await new Promise((resolve) => setTimeout(resolve, durationMs))
}

const main = async (): Promise<void> => {
  loadEnvForAgent()
  const config = getAgentConfig()
  logger.info('Agent starting', {
    provider: config.llm.provider,
    model: config.llm.model,
    threshold: config.thresholds.confidence,
    maxFailuresPerRun: config.limits.maxFailuresPerRun,
    interRequestDelayMs: config.runtime.interRequestDelayMs,
    llmMaxAttempts: config.llm.retry.maxAttempts,
    llmRetryInitialDelayMs: config.llm.retry.initialDelayMs,
    llmRetryMaxDelayMs: config.llm.retry.maxDelayMs,
    enableInCi: config.runtime.enableInCi,
    resultsJsonPath: config.paths.resultsJson,
    ci: process.env.CI === 'true',
    ...(config.llm.provider === 'ollama'
      ? {
          ollamaMaxDomChars: config.ollama.maxDomChars,
          ollamaMaxClassifyPredict: config.ollama.maxClassifyPredict,
          ollamaNumCtxMax: config.ollama.numCtxMax,
        }
      : {}),
  })

  if (process.env.CI === 'true' && !config.runtime.enableInCi) {
    logger.info('Agent skipped: CI execution disabled for Phase 1 development mode.')
    return
  }

  const failures = extractFailures(config).slice(0, config.limits.maxFailuresPerRun)
  if (failures.length === 0) {
    logger.info('No failed tests found in results file. Nothing to classify.')
    return
  }

  logger.info('Running classification-only mode', { failures: failures.length, phase: 'phase-1-dev' })

  for (const [index, failure] of failures.entries()) {
    try {
      const classification = await classifyFailure(failure)
      const decision =
        classification.confidence >= config.thresholds.confidence
          ? 'ABOVE_THRESHOLD'
          : 'BELOW_THRESHOLD'

      logger.info('Failure classified', {
        testName: failure.testName,
        testFile: failure.testFile,
        category: classification.category,
        confidence: classification.confidence,
        decision,
        reason: classification.reason,
        phase: 'phase-1-dev',
        actionsExecuted: 'none',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Classification error', {
        testName: failure.testName,
        error: message,
        phase: 'phase-1-dev',
      })
    }

    const isLastFailure = index === failures.length - 1
    if (!isLastFailure) {
      await sleep(config.runtime.interRequestDelayMs)
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  logger.error('Agent fatal error', { error: message })
  process.exit(1)
})
