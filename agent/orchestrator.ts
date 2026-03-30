import { classifyFailure } from './classifier.js'
import { getAgentConfig } from './config.js'
import { extractFailures } from './context.js'

const writeLog = (message: string): void => {
  process.stdout.write(`${message}\n`)
}

const writeWarn = (message: string): void => {
  process.stderr.write(`${message}\n`)
}

const main = async (): Promise<void> => {
  const config = getAgentConfig()

  if (process.env.CI === 'true' && !config.runtime.enableInCi) {
    writeLog('Agent skipped: CI execution disabled for Phase 1 development mode.')
    return
  }

  const failures = extractFailures(config).slice(0, config.limits.maxFailuresPerRun)
  if (failures.length === 0) {
    writeLog('No failed tests found in results file. Nothing to classify.')
    return
  }

  writeLog(`Found ${failures.length} failure(s). Running classification only (Phase 1).`)

  for (const failure of failures) {
    try {
      const classification = await classifyFailure(failure)
      const decision =
        classification.confidence >= config.thresholds.confidence
          ? 'ABOVE_THRESHOLD'
          : 'BELOW_THRESHOLD'

      writeLog(
        JSON.stringify({
          testName: failure.testName,
          category: classification.category,
          confidence: classification.confidence,
          decision,
          reason: classification.reason,
          phase: 'phase-1-dev',
          actionsExecuted: 'none',
        }),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeWarn(
        JSON.stringify({
          testName: failure.testName,
          error: message,
          phase: 'phase-1-dev',
          status: 'classification_error',
        }),
      )
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  writeWarn(`Agent fatal error: ${message}`)
  process.exit(1)
})
