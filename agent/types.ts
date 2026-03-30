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
  errorContextPath?: string
  errorContext?: string
  domSnapshotPath?: string
  domSnapshot?: string
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
    // Supported providers.
    provider: 'anthropic' | 'openai' | 'google' | 'mock'
    model: string
    apiKeyEnvVar: string
    maxTokens: {
      classify: number
    }
    temperature: {
      classify: number
    }
    retry: {
      maxAttempts: number
      initialDelayMs: number
      maxDelayMs: number
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
    interRequestDelayMs: number
  }
  paths: {
    resultsJson: string
  }
}
