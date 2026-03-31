import type { AgentConfig, OllamaPerformanceConfig } from './types.js'

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

const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = parseNumber(value, fallback)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer but received: ${parsed}`)
  }
  return parsed
}

const parseNonNegativeInteger = (value: string | undefined, fallback: number): number => {
  const parsed = parseNumber(value, fallback)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer but received: ${parsed}`)
  }
  return parsed
}

const parseLabelList = (value: string | undefined, fallback: string[]): string[] => {
  if (!value || value.trim() === '') {
    return fallback
  }
  const labels = value
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
  if (labels.length === 0) {
    return fallback
  }
  return labels
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
  if (provider === 'ollama') {
    return 'OLLAMA_API_KEY'
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
    providerRaw !== 'ollama'
  ) {
    throw new Error(`Unsupported AI_PROVIDER: ${providerRaw}`)
  }

  const confidence = parseNumber(process.env.AGENT_CONFIDENCE_THRESHOLD, 0.75)
  if (confidence < 0 || confidence > 1) {
    throw new Error('AGENT_CONFIDENCE_THRESHOLD must be between 0 and 1')
  }

  const defaultModel =
    providerRaw === 'ollama' ? 'qwen2.5:7b' : 'mock-classifier-v1'

  const ollamaNumCtxMin = parsePositiveInteger(
    process.env.AGENT_OLLAMA_NUM_CTX_MIN,
    4096,
  )
  const ollamaNumCtxMax = parsePositiveInteger(
    process.env.AGENT_OLLAMA_NUM_CTX_MAX,
    16384,
  )
  if (ollamaNumCtxMin > ollamaNumCtxMax) {
    throw new Error(
      'AGENT_OLLAMA_NUM_CTX_MIN must be less than or equal to AGENT_OLLAMA_NUM_CTX_MAX',
    )
  }

  const ollama: OllamaPerformanceConfig = {
    maxDomChars: parsePositiveInteger(process.env.AGENT_OLLAMA_MAX_DOM_CHARS, 8000),
    maxErrorContextChars: parsePositiveInteger(
      process.env.AGENT_OLLAMA_MAX_ERROR_CONTEXT_CHARS,
      6000,
    ),
    maxTestSourceChars: parsePositiveInteger(
      process.env.AGENT_OLLAMA_MAX_TEST_SOURCE_CHARS,
      10000,
    ),
    maxClassifyPredict: parsePositiveInteger(
      process.env.AGENT_OLLAMA_MAX_CLASSIFY_PREDICT,
      384,
    ),
    numCtxMin: ollamaNumCtxMin,
    numCtxMax: ollamaNumCtxMax,
  }

  return {
    llm: {
      provider: providerRaw,
      model: process.env.AI_MODEL ?? defaultModel,
      apiKeyEnvVar: getApiKeyEnvVar(providerRaw),
      maxTokens: {
        classify: parseNumber(process.env.AGENT_MAX_TOKENS_CLASSIFY, 600),
        heal: parseNumber(process.env.AGENT_MAX_TOKENS_HEAL, 14000),
      },
      temperature: {
        classify: parseNumber(process.env.AGENT_TEMPERATURE_CLASSIFY, 0),
        heal: parseNumber(process.env.AGENT_TEMPERATURE_HEAL, 0),
      },
      retry: {
        maxAttempts: parsePositiveInteger(process.env.AGENT_LLM_MAX_ATTEMPTS, 3),
        initialDelayMs: parsePositiveInteger(process.env.AGENT_LLM_RETRY_INITIAL_DELAY_MS, 1000),
        maxDelayMs: parsePositiveInteger(process.env.AGENT_LLM_RETRY_MAX_DELAY_MS, 8000),
      },
    },
    thresholds: {
      confidence,
    },
    limits: {
      maxFailuresPerRun: parseNumber(process.env.AGENT_MAX_FAILURES_PER_RUN, 3),
    },
    actions: {
      enableHealPr: parseBoolean(process.env.AGENT_ENABLE_HEAL_PR, false),
      enableBugIssue: parseBoolean(process.env.AGENT_ENABLE_BUG_ISSUE, false),
    },
    github: {
      baseBranch: process.env.AGENT_GITHUB_BASE_BRANCH ?? 'main',
      issueLabels: parseLabelList(process.env.AGENT_ISSUE_LABELS, [
        'bug',
        'automated-qa',
      ]),
    },
    runtime: {
      // Phase 1 is dev-only by default.
      enableInCi: parseBoolean(process.env.AGENT_ENABLE_IN_CI, false),
      interRequestDelayMs: parseNonNegativeInteger(process.env.AGENT_INTER_REQUEST_DELAY_MS, 750),
    },
    paths: {
      resultsJson: process.env.AGENT_RESULTS_JSON_PATH ?? 'test-results/results.json',
    },
    ollama,
  }
}
