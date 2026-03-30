import type { AgentConfig } from '../types.js'
import { AnthropicClient } from './anthropic-client.js'
import { GoogleClient } from './google-client.js'
import { MockClient } from './mock-client.js'
import { OpenAiClient } from './openai-client.js'
import type { LlmClient } from './types.js'

export const getLlmClient = (config: AgentConfig): LlmClient => {
  if (config.llm.provider === 'mock') {
    return new MockClient()
  }

  if (config.llm.provider === 'anthropic') {
    const key = process.env[config.llm.apiKeyEnvVar]
    if (!key) {
      throw new Error(`Missing API key for provider anthropic: ${config.llm.apiKeyEnvVar}`)
    }
    return new AnthropicClient(key, config.llm.model)
  }

  if (config.llm.provider === 'openai') {
    const key = process.env[config.llm.apiKeyEnvVar]
    if (!key) {
      throw new Error(`Missing API key for provider openai: ${config.llm.apiKeyEnvVar}`)
    }
    return new OpenAiClient(key, config.llm.model)
  }

  if (config.llm.provider === 'google') {
    const key = process.env[config.llm.apiKeyEnvVar]
    if (!key) {
      throw new Error(`Missing API key for provider google: ${config.llm.apiKeyEnvVar}`)
    }
    return new GoogleClient(key, config.llm.model)
  }

  throw new Error(`Unsupported provider: ${String(config.llm.provider)}`)
}
