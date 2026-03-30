import type { LlmClient } from './types.js'
import { logger } from '../logger.js'

interface CursorChoice {
  message?: {
    content?: string
  }
}

interface CursorResponse {
  choices?: CursorChoice[]
}

export class CursorClient implements LlmClient {
  private readonly apiKey: string | undefined
  private readonly model: string
  private readonly baseUrl: string

  constructor(apiKey: string | undefined, model: string) {
    this.apiKey = apiKey
    this.model = model
    this.baseUrl = process.env.CURSOR_BASE_URL ?? 'http://127.0.0.1:8787/v1'
  }

  async classifyFailure(input: {
    prompt: string
    maxTokens: number
    temperature: number
  }): Promise<string> {
    logger.debug('Cursor request started', {
      model: this.model,
      baseUrl: this.baseUrl,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      promptChars: input.prompt.length,
      hasAuthHeader: Boolean(this.apiKey),
    })

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
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
      throw new Error(`Cursor classify request failed: ${response.status} ${text}`)
    }

    logger.debug('Cursor request succeeded', { status: response.status })
    const data = (await response.json()) as CursorResponse
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) {
      throw new Error('Cursor response missing message content')
    }
    return content
  }
}
