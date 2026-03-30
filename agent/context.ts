import { existsSync, readFileSync } from 'node:fs'
import type { AgentConfig, FailureContext } from './types.js'

interface PlaywrightAttachment {
  name?: string
  path?: string
}

interface PlaywrightResult {
  status?: string
  error?: {
    message?: string
    stack?: string
  }
  attachments?: PlaywrightAttachment[]
}

interface PlaywrightTest {
  results?: PlaywrightResult[]
}

interface PlaywrightSpec {
  title?: string
  file?: string
  tests?: PlaywrightTest[]
}

interface PlaywrightSuite {
  suites?: PlaywrightSuite[]
  specs?: PlaywrightSpec[]
}

interface PlaywrightJson {
  suites?: PlaywrightSuite[]
}

const buildRunUrl = (): string => {
  const server = process.env.GITHUB_SERVER_URL
  const repo = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  if (!server || !repo || !runId) {
    return ''
  }
  return `${server}/${repo}/actions/runs/${runId}`
}

const getTestSource = (filePath: string): string => {
  if (!filePath || !existsSync(filePath)) {
    return ''
  }
  return readFileSync(filePath, 'utf-8')
}

const getScreenshotPath = (attachments: PlaywrightAttachment[] | undefined): string | undefined => {
  if (!attachments) {
    return undefined
  }
  const screenshot = attachments.find((item) => item.name === 'screenshot' && item.path)
  return screenshot?.path
}

const collectFailuresFromSuite = (suite: PlaywrightSuite, failures: FailureContext[]): void => {
  for (const child of suite.suites ?? []) {
    collectFailuresFromSuite(child, failures)
  }

  for (const spec of suite.specs ?? []) {
    const testFile = spec.file ?? ''
    const testSource = getTestSource(testFile)

    for (const test of spec.tests ?? []) {
      for (const result of test.results ?? []) {
        if (result.status !== 'failed') {
          continue
        }

        failures.push({
          testName: spec.title ?? 'unknown test',
          testFile,
          testSource,
          error: result.error?.message ?? '',
          errorStack: result.error?.stack ?? '',
          screenshotPath: getScreenshotPath(result.attachments),
          runUrl: buildRunUrl(),
          branch: process.env.GITHUB_REF_NAME ?? '',
          commit: process.env.GITHUB_SHA ?? '',
        })
      }
    }
  }
}

export const extractFailures = (config: AgentConfig): FailureContext[] => {
  if (!existsSync(config.paths.resultsJson)) {
    return []
  }

  const raw = readFileSync(config.paths.resultsJson, 'utf-8')
  const parsed = JSON.parse(raw) as PlaywrightJson
  const failures: FailureContext[] = []

  for (const suite of parsed.suites ?? []) {
    collectFailuresFromSuite(suite, failures)
  }

  return failures
}
