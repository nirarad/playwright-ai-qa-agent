import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
  config?: {
    rootDir?: string
  }
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

/**
 * Playwright JSON stores `file` as a basename (e.g. `tasks.spec.ts`). Resolve it
 * using `config.rootDir` from the same report, then repo-relative fallbacks.
 */
const readTestSourceForSpec = (
  relFile: string,
  rootDir: string | undefined,
  resultsJsonPath: string,
): string => {
  if (!relFile) {
    return ''
  }

  const attempts: string[] = []
  if (relFile.includes('/') || relFile.includes('\\')) {
    attempts.push(relFile)
  }
  if (rootDir) {
    attempts.push(join(rootDir, relFile))
  }

  const absResults = resolve(resultsJsonPath)
  const repoRoot = dirname(dirname(absResults))
  attempts.push(
    join(repoRoot, 'tests', 'showcase', relFile),
    join(repoRoot, 'tests', relFile),
  )

  for (const candidate of attempts) {
    if (candidate && existsSync(candidate)) {
      return readFileSync(candidate, 'utf-8')
    }
  }

  logger.debug('Test source file not found on disk', {
    relFile,
    rootDir,
    resultsJsonPath: absResults,
  })
  return ''
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

const collectFailuresFromSuite = (
  suite: PlaywrightSuite,
  failures: FailureContext[],
  rootDir: string | undefined,
  resultsJsonPath: string,
): void => {
  for (const child of suite.suites ?? []) {
    collectFailuresFromSuite(child, failures, rootDir, resultsJsonPath)
  }

  for (const spec of suite.specs ?? []) {
    const testFile = spec.file ?? ''
    const testSource = readTestSourceForSpec(testFile, rootDir, resultsJsonPath)

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

  const absResultsJson = resolve(config.paths.resultsJson)
  logger.debug('Reading Playwright results', { path: absResultsJson })
  const raw = readFileSync(absResultsJson, 'utf-8')
  const parsed = JSON.parse(raw) as PlaywrightJson
  const failures: FailureContext[] = []
  const rootDir = parsed.config?.rootDir

  for (const suite of parsed.suites ?? []) {
    collectFailuresFromSuite(suite, failures, rootDir, absResultsJson)
  }

  logger.info('Failure extraction complete', { failureCount: failures.length })
  return failures
}
