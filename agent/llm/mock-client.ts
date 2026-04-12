import type { ClassificationResult } from '../types.js'
import { logger } from '../logger.js'
import type { LlmClient } from './types.js'

/**
 * Use only the Playwright error/stack/messages + test source so instruction prose
 * (e.g. "waiting for …" in the prompt template) does not trigger mock rules.
 */
const extractSignals = (prompt: string): string => {
  const m = prompt.match(
    /Error \(primary message from Playwright\):\s*([\s\S]*?)\nTest source:\s*([\s\S]*)$/im,
  )
  if (m) {
    return `${m[1]}\n${m[2]}`.toLowerCase()
  }
  return prompt.toLowerCase()
}

const classifyFromPrompt = (prompt: string): ClassificationResult => {
  const input = extractSignals(prompt)

  if (input.includes('expected') && input.includes('received')) {
    return {
      category: 'REAL_BUG',
      confidence: 0.84,
      reason: 'Assertion mismatch indicates behavior diverges from expectation.',
      issueTitle: 'UI behavior mismatch: expected state not reached',
      suggestedFix: null,
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

  if (
    input.includes('timed out') ||
    input.includes('timeout exceeded') ||
    input.includes('test timeout')
  ) {
    return {
      category: 'FLAKY',
      confidence: 0.72,
      reason: 'Timing or environment instability is likely.',
      issueTitle: 'Flaky behavior: timing mismatch detected',
      suggestedFix: null,
    }
  }

  if (
    input.includes('getbytestid') ||
    input.includes('strict mode violation') ||
    input.includes('waiting for locator') ||
    input.includes('waiting for getbytestid') ||
    input.includes('element is not attached') ||
    (input.includes('locator') &&
      (input.includes('waiting for') || input.includes('resolved to 0')))
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
    input.includes('tohaveurl') ||
    input.includes('toequal') ||
    input.includes('tobevisible') ||
    input.includes('tohavecount')
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

  async generateFix(input: {
    prompt: string
    maxTokens: number
    temperature: number
  }): Promise<string> {
    void input.maxTokens
    void input.temperature

    const sourceMatch = input.prompt.match(/Current test source:\s*([\s\S]*)$/)
    const source = sourceMatch?.[1]?.trim()
    if (!source) {
      throw new Error('Mock generateFix could not extract test source from prompt')
    }

    logger.debug('Mock generateFix returned source passthrough', {
      sourceChars: source.length,
    })
    return source
  }
}
