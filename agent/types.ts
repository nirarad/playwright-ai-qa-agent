export type FailureCategory =
  | 'BROKEN_LOCATOR'
  | 'REAL_BUG'
  | 'FLAKY'
  | 'ENV_ISSUE'

export interface FailureContext {
  testName: string
  testFile: string
  testSource: string
  error: string
  errorStack: string
  screenshotPath?: string
  runUrl: string
  branch: string
  commit: string
}

export interface ClassificationResult {
  category: FailureCategory
  confidence: number
  reason: string
  suggestedFix: string | null
}

export interface AgentConfig {
  llm: {
    // Plan providers: anthropic | openai | google.
    // mock and cursor are kept as dev-oriented providers.
    provider: 'anthropic' | 'openai' | 'google' | 'mock' | 'cursor'
    model: string
    apiKeyEnvVar: string
    maxTokens: {
      classify: number
    }
    temperature: {
      classify: number
    }
  }
  thresholds: {
    confidence: number
  }
  limits: {
    maxFailuresPerRun: number
  }
  runtime: {
    enableInCi: boolean
  }
  paths: {
    resultsJson: string
  }
}
