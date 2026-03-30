import { getAgentConfig } from '../config.js'
import { logger } from '../logger.js'
import { withProviderRetry } from './retry.js'
import type { LlmClient } from './types.js'

interface OllamaResponse {
  response?: string
}

const LARGE_PROMPT_CHARS = 6000
const HEARTBEAT_INTERVAL_MS = 90_000

const parseOllamaRequestTimeoutMs = (): number => {
  const raw = process.env.OLLAMA_REQUEST_TIMEOUT_MS
  if (!raw) {
    return 0
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error(
      `OLLAMA_REQUEST_TIMEOUT_MS must be a non-negative integer (ms), got: ${raw}`,
    )
  }
  return parsed
}

const runWithOptionalHeartbeat = async <T>(
  promptChars: number,
  work: () => Promise<T>,
): Promise<T> => {
  if (promptChars < LARGE_PROMPT_CHARS) {
    return work()
  }

  logger.info(
    'Ollama: large prompt; CPU inference often takes several minutes with no ' +
      'intermediate output until /api/generate completes',
    { promptChars },
  )

  let tick = 0
  const interval = setInterval(() => {
    tick += 1
    logger.info('Ollama: still generating...', {
      promptChars,
      elapsedIntervalsMin: (tick * HEARTBEAT_INTERVAL_MS) / 60_000,
    })
  }, HEARTBEAT_INTERVAL_MS)

  try {
    return await work()
  } finally {
    clearInterval(interval)
  }
}

const computeOllamaNumCtx = (
  promptChars: number,
  maxPredict: number,
  min: number,
  max: number,
): number => {
  const estimated = Math.ceil(promptChars / 3) + maxPredict + 512
  return Math.min(max, Math.max(min, estimated))
}

export class OllamaClient implements LlmClient {
  private readonly model: string
  private readonly baseUrl: string

  constructor(model: string) {
    this.model = model
    this.baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
  }

  async classifyFailure(input: {
    prompt: string
    maxTokens: number
    temperature: number
  }): Promise<string> {
    const timeoutMs = parseOllamaRequestTimeoutMs()
    const perf = getAgentConfig().ollama
    const cappedPredict = Math.min(input.maxTokens, perf.maxClassifyPredict)
    const numCtx = computeOllamaNumCtx(
      input.prompt.length,
      cappedPredict,
      perf.numCtxMin,
      perf.numCtxMax,
    )

    logger.debug('Ollama request started', {
      model: this.model,
      baseUrl: this.baseUrl,
      maxTokens: input.maxTokens,
      numPredict: cappedPredict,
      numCtx,
      temperature: input.temperature,
      promptChars: input.prompt.length,
      requestTimeoutMs: timeoutMs || 'none',
    })

    const data = await withProviderRetry('ollama', async () => {
      return runWithOptionalHeartbeat(input.prompt.length, async () => {
        const init: RequestInit = {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            prompt: input.prompt,
            stream: false,
            format: 'json',
            options: {
              temperature: input.temperature,
              num_predict: cappedPredict,
              num_ctx: numCtx,
            },
          }),
        }
        if (timeoutMs > 0) {
          init.signal = AbortSignal.timeout(timeoutMs)
        }

        let response: Response
        try {
          response = await fetch(`${this.baseUrl}/api/generate`, init)
        } catch (err) {
          const isAbort =
            err instanceof Error &&
            (err.name === 'AbortError' || err.name === 'TimeoutError')
          if (isAbort && timeoutMs > 0) {
            throw new Error(
              `Ollama classify timed out after ${timeoutMs}ms (OLLAMA_REQUEST_TIMEOUT_MS). ` +
                'Large prompts on CPU are slow; raise the limit, enable GPU, or trim context.',
            )
          }
          throw err
        }

        if (!response.ok) {
          const text = await response.text()
          const base = `Ollama classify request failed: ${response.status} ${text}`
          if (response.status === 404) {
            throw new Error(
              `${base} Hint: install the model on that Ollama server (e.g. ollama pull ${this.model}, or use OLLAMA_PULL_MODEL with the repo ollama/ Docker setup).`,
            )
          }
          throw new Error(base)
        }

        logger.debug('Ollama request succeeded', { status: response.status })
        return (await response.json()) as OllamaResponse
      })
    })

    const content = data.response?.trim()
    if (!content) {
      throw new Error('Ollama response missing generated text')
    }
    return content
  }
}

