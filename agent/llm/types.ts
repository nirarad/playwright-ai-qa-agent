export interface LlmClient {
  classifyFailure(input: {
    prompt: string
    maxTokens: number
    temperature: number
  }): Promise<string>
}
