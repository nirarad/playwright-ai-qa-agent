export interface LlmClient {
  classifyFailure(input: {
    prompt: string
    maxTokens: number
    temperature: number
  }): Promise<string>
  generateFix(input: {
    prompt: string
    maxTokens: number
    temperature: number
  }): Promise<string>
}
