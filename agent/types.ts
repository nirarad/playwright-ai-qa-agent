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

/** Limits for trimming optional fields before any LLM classification call. */
export interface ClassificationContextLimits {
  maxDomChars: number
  maxErrorContextChars: number
  maxTestSourceChars: number
}

/** Ollama HTTP API tuning (num_ctx, num_predict cap). */
export interface OllamaPerformanceConfig {
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
      heal: number
    }
    temperature: {
      classify: number
      heal: number
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
  classificationContext: ClassificationContextLimits
  /** Ollama `/api/generate` options (context window sizing). */
  ollama: OllamaPerformanceConfig
}
