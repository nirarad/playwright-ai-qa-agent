import type { LlmClient } from './types.js'
import { logger } from '../logger.js'
import { withProviderRetry } from './retry.js'

interface AnthropicContentBlock {
  type: string
  text?: string
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[]
}

export class AnthropicClient implements LlmClient {
  private readonly apiKey: string
  private readonly model: string

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey
    this.model = model
  }

  async classifyFailure(input: {
    prompt: string
    maxTokens: number
    temperature: number
  }): Promise<string> {
    logger.debug('Anthropic request started', {
      model: this.model,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      promptChars: input.prompt.length,
    })

    const data = await withProviderRetry('anthropic', async () => {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: input.maxTokens,
          temperature: input.temperature,
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
        throw new Error(`Anthropic classify request failed: ${response.status} ${text}`)
      }

      logger.debug('Anthropic request succeeded', { status: response.status })
      return (await response.json()) as AnthropicResponse
    })
    const textBlock = data.content?.find((block) => block.type === 'text' && block.text)
    if (!textBlock?.text) {
      throw new Error('Anthropic response missing text content')
    }
    return textBlock.text.trim()
  }

  async generateFix(input: {
    prompt: string
    maxTokens: number
    temperature: number
  }): Promise<string> {
    logger.debug('Anthropic generateFix request started', {
      model: this.model,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      promptChars: input.prompt.length,
    })

    const data = await withProviderRetry('anthropic', async () => {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: input.maxTokens,
          temperature: input.temperature,
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
        throw new Error(`Anthropic generateFix request failed: ${response.status} ${text}`)
      }

      logger.debug('Anthropic generateFix request succeeded', { status: response.status })
      return (await response.json()) as AnthropicResponse
    })
    const textBlock = data.content?.find((block) => block.type === 'text' && block.text)
    if (!textBlock?.text) {
      throw new Error('Anthropic generateFix response missing text content')
    }
    return textBlock.text.trim()
  }
}
