import type { LlmClient } from './types.js'

interface GooglePart {
  text?: string
}

interface GoogleCandidate {
  content?: {
    parts?: GooglePart[]
  }
}

interface GoogleResponse {
  candidates?: GoogleCandidate[]
}

export class GoogleClient implements LlmClient {
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey
    this.model = model
    this.baseUrl =
      process.env.GOOGLE_BASE_URL ??
      'https://generativelanguage.googleapis.com/v1beta/models'
  }

  async classifyFailure(input: {
    prompt: string
    maxTokens: number
    temperature: number
  }): Promise<string> {
    const response = await fetch(
      `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: input.prompt }],
            },
          ],
          generationConfig: {
            temperature: input.temperature,
            maxOutputTokens: input.maxTokens,
          },
        }),
      },
    )

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Google classify request failed: ${response.status} ${text}`)
    }

    const data = (await response.json()) as GoogleResponse
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    if (!content) {
      throw new Error('Google response missing generated text')
    }
    return content
  }
}
