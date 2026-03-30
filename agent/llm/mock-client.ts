import type { ClassificationResult } from '../types.js'
import { logger } from '../logger.js'
import type { LlmClient } from './types.js'

const extractSignals = (prompt: string): string => {
  const errorMatch = prompt.match(/Error:\s*([\s\S]*?)\nStack:/)
  const stackMatch = prompt.match(/Stack:\s*([\s\S]*?)\n\nTest source:/)
  const sourceMatch = prompt.match(/Test source:\s*([\s\S]*)$/)
  return `${errorMatch?.[1] ?? ''}\n${stackMatch?.[1] ?? ''}\n${sourceMatch?.[1] ?? ''}`.toLowerCase()
}

const classifyFromPrompt = (prompt: string): ClassificationResult => {
  const input = extractSignals(prompt)

  if (
    input.includes('getbytestid') ||
    input.includes('locator') ||
    input.includes('strict mode violation') ||
    input.includes('waiting for locator') ||
    input.includes('element is not attached')
  ) {
    return {
      category: 'BROKEN_LOCATOR',
      confidence: 0.86,
      reason: 'Element targeting appears stale or renamed.',
      issueTitle: 'Locator mismatch: selector no longer finds the element',
      suggestedFix: 'Prefer stable data-testid values and update locator usage.',
    }
  }

  if (
    input.includes('net::err_') ||
    input.includes('econnrefused') ||
    input.includes('connection refused')
  ) {
    return {
      category: 'ENV_ISSUE',
      confidence: 0.78,
      reason: 'Connectivity or environment setup issue is likely.',
      issueTitle: 'Environment issue: connection refused',
      suggestedFix: null,
    }
  }

  if (input.includes('timeout') || input.includes('timed out')) {
    return {
      category: 'FLAKY',
      confidence: 0.72,
      reason: 'Timing or environment instability is likely.',
      issueTitle: 'Flaky behavior: timing mismatch detected',
      suggestedFix: null,
    }
  }

  if (
    input.includes('tohaveurl') ||
    input.includes('toequal') ||
    input.includes('tobevisible') ||
    (input.includes('expected') && input.includes('received'))
  ) {
    return {
      category: 'REAL_BUG',
      confidence: 0.84,
      reason: 'Assertion mismatch indicates behavior diverges from expectation.',
      issueTitle: 'UI behavior mismatch: expected state not reached',
      suggestedFix: null,
    }
  }

  return {
    category: 'ENV_ISSUE',
    confidence: 0.65,
    reason: 'Failure pattern does not clearly map to app logic or locator breakage.',
    issueTitle: 'Environment issue: unable to classify failure source',
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
    const result = classifyFromPrompt(input.prompt)
    logger.debug('Mock classifier produced result', {
      category: result.category,
      confidence: result.confidence,
      reason: result.reason,
    })
    return JSON.stringify(result)
  }
}
