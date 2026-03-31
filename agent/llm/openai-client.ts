import type { LlmClient } from './types.js'
import { logger } from '../logger.js'
import { withProviderRetry } from './retry.js'

interface OpenAiChoice {
  message?: {
    content?: string
  }
}

interface OpenAiResponse {
  choices?: OpenAiChoice[]
}

export class OpenAiClient implements LlmClient {
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey
    this.model = model
    this.baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
  }

  async classifyFailure(input: {
    prompt: string
    maxTokens: number
    temperature: number
  }): Promise<string> {
    logger.debug('OpenAI request started', {
      model: this.model,
      baseUrl: this.baseUrl,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      promptChars: input.prompt.length,
    })

    const data = await withProviderRetry('openai', async () => {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: input.temperature,
          max_tokens: input.maxTokens,
          messages: [
            {
              role: 'user',
              content: input.prompt,
            },
          ],
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`OpenAI classify request failed: ${response.status} ${text}`)
      }

      logger.debug('OpenAI request succeeded', { status: response.status })
      return (await response.json()) as OpenAiResponse
    })
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) {
      throw new Error('OpenAI response missing message content')
    }
    return content
  }

  async generateFix(input: {
    prompt: string
    maxTokens: number
    temperature: number
  }): Promise<string> {
    logger.debug('OpenAI generateFix request started', {
      model: this.model,
      baseUrl: this.baseUrl,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      promptChars: input.prompt.length,
    })

    const data = await withProviderRetry('openai', async () => {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: input.temperature,
          max_tokens: input.maxTokens,
          messages: [
            {
              role: 'user',
              content: input.prompt,
            },
          ],
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`OpenAI generateFix request failed: ${response.status} ${text}`)
      }

      logger.debug('OpenAI generateFix request succeeded', { status: response.status })
      return (await response.json()) as OpenAiResponse
    })
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) {
      throw new Error('OpenAI generateFix response missing message content')
    }
    return content
  }
}
