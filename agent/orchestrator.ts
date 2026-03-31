import { classifyFailure } from './classifier.js'
import { getAgentConfig } from './config.js'
import { extractFailures } from './context.js'
import { loadEnvForAgent } from './env.js'
import { logger } from './logger.js'
import { createBugIssue } from './reporter.js'

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
    enableBugIssue: config.actions.enableBugIssue,
    enableHealPr: config.actions.enableHealPr,
    githubBaseBranch: config.github.baseBranch,
    ...(config.llm.provider === 'ollama'
      ? {
          ollamaMaxDomChars: config.ollama.maxDomChars,
          ollamaMaxClassifyPredict: config.ollama.maxClassifyPredict,
          ollamaNumCtxMax: config.ollama.numCtxMax,
        }
      : {}),
  })

  if (process.env.CI === 'true' && !config.runtime.enableInCi) {
    logger.info('Agent skipped: AGENT_ENABLE_IN_CI is not true.')
    return
  }

  const failures = extractFailures(config).slice(0, config.limits.maxFailuresPerRun)
  if (failures.length === 0) {
    logger.info('No failed tests found in results file. Nothing to classify.')
    return
  }

  logger.info('Processing failed tests', {
    failures: failures.length,
    phase: 'phase-2',
  })

  for (const [index, failure] of failures.entries()) {
    let classification
    try {
      classification = await classifyFailure(failure)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Classification error', {
        testName: failure.testName,
        error: message,
        phase: 'phase-2',
      })
      const isLastFailure = index === failures.length - 1
      if (!isLastFailure) {
        await sleep(config.runtime.interRequestDelayMs)
      }
      continue
    }

    const aboveThreshold =
      classification.confidence >= config.thresholds.confidence
    const decision = aboveThreshold ? 'ABOVE_THRESHOLD' : 'BELOW_THRESHOLD'

    let actionsExecuted: 'github-issue' | 'none' = 'none'
    const reportableCategory =
      classification.category === 'BROKEN_LOCATOR' ||
      classification.category === 'REAL_BUG' ||
      classification.category === 'ENV_ISSUE'
    if (aboveThreshold && reportableCategory && config.actions.enableBugIssue) {
      await createBugIssue(failure, classification, config)
      actionsExecuted = 'github-issue'
    }

    logger.info('Failure classified', {
      testName: failure.testName,
      testFile: failure.testFile,
      category: classification.category,
      confidence: classification.confidence,
      decision,
      reason: classification.reason,
      phase: 'phase-2',
      actionsExecuted,
    })

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
