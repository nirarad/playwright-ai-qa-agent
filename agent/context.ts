import { existsSync, readFileSync } from 'node:fs'
import type { AgentConfig, FailureContext } from './types.js'
import { logger } from './logger.js'

interface PlaywrightAttachment {
  name?: string
  path?: string
}

interface PlaywrightSecondaryError {
  message?: string
}

interface PlaywrightResult {
  status?: string
  error?: {
    message?: string
    stack?: string
  }
  errors?: PlaywrightSecondaryError[]
  attachments?: PlaywrightAttachment[]
}

interface PlaywrightTest {
  status?: string
  expectedStatus?: string
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

const isFailureResultStatus = (status: string | undefined): boolean => {
  if (!status) {
    return false
  }
  return status === 'failed' || status === 'timedOut' || status === 'interrupted'
}

const isUnexpectedTestStatus = (
  status: string | undefined,
  expectedStatus: string | undefined,
): boolean => {
  if (!status || !expectedStatus) {
    return false
  }
  return status === 'unexpected' && expectedStatus === 'passed'
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

const getAttachmentPath = (
  attachments: PlaywrightAttachment[] | undefined,
  attachmentName: string,
): string | undefined => {
  if (!attachments) {
    return undefined
  }
  return attachments.find((item) => item.name === attachmentName && item.path)?.path
}

const readTextAttachment = (path: string | undefined, maxChars: number): string | undefined => {
  if (!path || !existsSync(path)) {
    return undefined
  }
  const raw = readFileSync(path, 'utf-8')
  if (raw.length <= maxChars) {
    return raw
  }
  return `${raw.slice(0, maxChars)}\n\n...[truncated]`
}

const joinPlaywrightErrorMessages = (
  errors: PlaywrightSecondaryError[] | undefined,
): string | undefined => {
  if (!errors?.length) {
    return undefined
  }
  const parts = errors
    .map((entry) => entry.message?.trim())
    .filter((message): message is string => Boolean(message && message.length))
  if (!parts.length) {
    return undefined
  }
  return parts.join('\n\n')
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
        const isFailure =
          isFailureResultStatus(result.status) ||
          isUnexpectedTestStatus(test.status, test.expectedStatus)
        if (!isFailure) {
          continue
        }

        failures.push({
          testName: spec.title ?? 'unknown test',
          testFile,
          testSource,
          error: result.error?.message ?? '',
          errorStack: result.error?.stack ?? '',
          playwrightErrorMessages: joinPlaywrightErrorMessages(result.errors),
          screenshotPath: getScreenshotPath(result.attachments),
          errorContextPath: getAttachmentPath(result.attachments, 'error-context'),
          errorContext: readTextAttachment(
            getAttachmentPath(result.attachments, 'error-context'),
            20000,
          ),
          domSnapshotPath: getAttachmentPath(result.attachments, 'dom-snapshot'),
          domSnapshot: readTextAttachment(
            getAttachmentPath(result.attachments, 'dom-snapshot'),
            30000,
          ),
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
    logger.warn('Results file not found', { path: config.paths.resultsJson })
    return []
  }

  logger.debug('Reading Playwright results', { path: config.paths.resultsJson })
  const raw = readFileSync(config.paths.resultsJson, 'utf-8')
  const parsed = JSON.parse(raw) as PlaywrightJson
  const failures: FailureContext[] = []

  for (const suite of parsed.suites ?? []) {
    collectFailuresFromSuite(suite, failures)
  }

  logger.info('Failure extraction complete', { failureCount: failures.length })
  return failures
}
