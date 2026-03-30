import type { AgentConfig } from './types.js'

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback
  }
  const parsed = Number(value)
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric env value: ${value}`)
  }
  return parsed
}

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) {
    return fallback
  }
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  throw new Error(`Invalid boolean env value: ${value}`)
}

const getApiKeyEnvVar = (provider: AgentConfig['llm']['provider']): string => {
  if (provider === 'anthropic') {
    return 'ANTHROPIC_API_KEY'
  }
  if (provider === 'openai') {
    return 'OPENAI_API_KEY'
  }
  if (provider === 'google') {
    return 'GOOGLE_API_KEY'
  }
  if (provider === 'cursor') {
    return 'CURSOR_API_KEY'
  }
  return 'MOCK_API_KEY'
}

export const getAgentConfig = (): AgentConfig => {
  const providerRaw = process.env.AI_PROVIDER ?? 'mock'
  if (
    providerRaw !== 'mock' &&
    providerRaw !== 'anthropic' &&
    providerRaw !== 'openai' &&
    providerRaw !== 'google' &&
    providerRaw !== 'cursor'
  ) {
    throw new Error(`Unsupported AI_PROVIDER: ${providerRaw}`)
  }

  const confidence = parseNumber(process.env.AGENT_CONFIDENCE_THRESHOLD, 0.75)
  if (confidence < 0 || confidence > 1) {
    throw new Error('AGENT_CONFIDENCE_THRESHOLD must be between 0 and 1')
  }

  return {
    llm: {
      provider: providerRaw,
      model: process.env.AI_MODEL ?? 'mock-classifier-v1',
      apiKeyEnvVar: getApiKeyEnvVar(providerRaw),
      maxTokens: {
        classify: parseNumber(process.env.AGENT_MAX_TOKENS_CLASSIFY, 600),
      },
      temperature: {
        classify: parseNumber(process.env.AGENT_TEMPERATURE_CLASSIFY, 0),
      },
    },
    thresholds: {
      confidence,
    },
    limits: {
      maxFailuresPerRun: parseNumber(process.env.AGENT_MAX_FAILURES_PER_RUN, 3),
    },
    runtime: {
      // Phase 1 is dev-only by default.
      enableInCi: parseBoolean(process.env.AGENT_ENABLE_IN_CI, false),
    },
    paths: {
      resultsJson: process.env.AGENT_RESULTS_JSON_PATH ?? 'test-results/results.json',
    },
  }
}
