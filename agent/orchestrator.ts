import { classifyFailure } from './classifier.js'
import { getAgentConfig } from './config.js'
import { extractFailures } from './context.js'
import { logger } from './logger.js'

const main = async (): Promise<void> => {
  const config = getAgentConfig()
  logger.info('Agent starting', {
    provider: config.llm.provider,
    model: config.llm.model,
    threshold: config.thresholds.confidence,
    maxFailuresPerRun: config.limits.maxFailuresPerRun,
    enableInCi: config.runtime.enableInCi,
    resultsJsonPath: config.paths.resultsJson,
    ci: process.env.CI === 'true',
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

  for (const failure of failures) {
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
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  logger.error('Agent fatal error', { error: message })
  process.exit(1)
})
