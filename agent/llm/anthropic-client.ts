import type { LlmClient } from './types.js'

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

    const data = (await response.json()) as AnthropicResponse
    const textBlock = data.content?.find((block) => block.type === 'text' && block.text)
    if (!textBlock?.text) {
      throw new Error('Anthropic response missing text content')
    }
    return textBlock.text.trim()
  }
}
