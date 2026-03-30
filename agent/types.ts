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
  /** Joined `result.errors[].message` from Playwright JSON (call logs, etc.). */
  playwrightErrorMessages?: string
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
  /**
   * Short, direct issue title fragment.
   * Must follow QA style: `<something>: <short failure summary>`
   */
  issueTitle: string
  suggestedFix: string | null
}

export interface OllamaPerformanceConfig {
  maxDomChars: number
  maxErrorContextChars: number
  maxTestSourceChars: number
  maxClassifyPredict: number
  numCtxMin: number
  numCtxMax: number
}

export interface AgentConfig {
  llm: {
    // Supported providers.
    provider: 'anthropic' | 'openai' | 'google' | 'ollama' | 'mock'
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
  actions: {
    enableHealPr: boolean
    enableBugIssue: boolean
  }
  github: {
    baseBranch: string
    issueLabels: string[]
  }
  runtime: {
    enableInCi: boolean
    interRequestDelayMs: number
  }
  paths: {
    resultsJson: string
  }
  /** Used when `llm.provider` is `ollama` (prompt trim + generate options). */
  ollama: OllamaPerformanceConfig
}
