import { getAgentConfig } from '../config.js'
import { logger } from '../logger.js'

const sleep = async (durationMs: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, durationMs))
}

const getStatusCodeFromMessage = (message: string): number | null => {
  const match = message.match(/\b(\d{3})\b/)
  if (!match) {
    return null
  }
  return Number(match[1])
}

const isRetriableError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  const statusCode = getStatusCodeFromMessage(message)
  if (statusCode === null) {
    return false
  }

  return statusCode === 429 || statusCode === 503 || statusCode === 504
}

const getBackoffMs = (
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
): number => {
  const exponential = initialDelayMs * 2 ** Math.max(attempt - 1, 0)
  return Math.min(exponential, maxDelayMs)
}

export const withProviderRetry = async <T>(
  provider: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const config = getAgentConfig()
  const { maxAttempts, initialDelayMs, maxDelayMs } = config.llm.retry

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const isRetriable = isRetriableError(error)
      const shouldRetry = isRetriable && attempt < maxAttempts
      const message = error instanceof Error ? error.message : String(error)

      logger.warn('LLM request failed', {
        provider,
        attempt,
        maxAttempts,
        retriable: isRetriable,
        error: message,
      })

      if (!shouldRetry) {
        throw error
      }

      const waitMs = getBackoffMs(attempt, initialDelayMs, maxDelayMs)
      logger.info('Retrying LLM request after delay', {
        provider,
        attempt,
        waitMs,
      })
      await sleep(waitMs)
    }
  }

  throw new Error(`Unexpected retry loop completion for provider: ${provider}`)
}
