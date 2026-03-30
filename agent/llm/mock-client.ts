import type { ClassificationResult } from '../types.js'
import type { LlmClient } from './types.js'

const classifyFromPrompt = (prompt: string): ClassificationResult => {
  const input = prompt.toLowerCase()

  if (
    input.includes('tohaveurl') ||
    input.includes('expected') ||
    input.includes('received')
  ) {
    return {
      category: 'REAL_BUG',
      confidence: 0.84,
      reason: 'Assertion mismatch indicates behavior diverges from expectation.',
      suggestedFix: null,
    }
  }

  if (
    input.includes('getbytestid') ||
    input.includes('locator') ||
    input.includes('strict mode violation')
  ) {
    return {
      category: 'BROKEN_LOCATOR',
      confidence: 0.86,
      reason: 'Element targeting appears stale or renamed.',
      suggestedFix: 'Prefer stable data-testid values and update locator usage.',
    }
  }

  if (input.includes('timeout') || input.includes('net::err_')) {
    return {
      category: 'FLAKY',
      confidence: 0.7,
      reason: 'Timing or environment instability is likely.',
      suggestedFix: null,
    }
  }

  return {
    category: 'ENV_ISSUE',
    confidence: 0.65,
    reason: 'Failure pattern does not clearly map to app logic or locator breakage.',
    suggestedFix: null,
  }
}

export class MockClient implements LlmClient {
  async classifyFailure(input: {
    prompt: string
    maxTokens: number
    temperature: number
  }): Promise<string> {
    void input.maxTokens
    void input.temperature
    return JSON.stringify(classifyFromPrompt(input.prompt))
  }
}
