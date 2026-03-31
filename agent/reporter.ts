import { createHash } from 'node:crypto'
import { basename } from 'node:path'

import type {
  AgentConfig,
  ClassificationResult,
  FailureCategory,
  FailureContext,
} from './types.js'
import { logger } from './logger.js'

const GITHUB_API_VERSION = '2022-11-28'

const getGitHubApiBase = (): string => {
  const raw = process.env.GITHUB_API_URL
  if (!raw || raw.trim() === '') {
    return 'https://api.github.com'
  }
  return raw.replace(/\/+$/, '')
}

const parseRepository = (repo: string): { owner: string; repo: string } => {
  const parts = repo.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      'GITHUB_REPOSITORY must be "owner/repo" (e.g. org/playwright-ai-qa-agent)',
    )
  }
  return { owner: parts[0], repo: parts[1] }
}

const authHeaders = (token: string): Record<string, string> => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': GITHUB_API_VERSION,
})

const stripAnsi = (value: string): string => {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}

const stripUnsafeControlChars = (value: string): string => {
  // Preserve newline/tab/carriage return for readable formatting.
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
}

const sanitizeForMarkdownCodeBlock = (value: string): string => {
  return stripUnsafeControlChars(stripAnsi(value)).trim()
}

const isHttpUrl = (value: string): boolean => {
  return value.startsWith('http://') || value.startsWith('https://')
}

const toRepoRelativeArtifactHint = (value: string): string | null => {
  const normalized = value.replace(/\\/g, '/')
  const index = normalized.toLowerCase().indexOf('test-results/')
  if (index < 0) {
    return null
  }
  return normalized.slice(index)
}

const looksLikeAbsoluteWindowsPath = (value: string): boolean => {
  return /^[a-zA-Z]:[\\/]/.test(value)
}

const buildScreenshotSection = (ctx: FailureContext): string => {
  if (!ctx.screenshotPath || ctx.screenshotPath.trim() === '') {
    return '## Screenshot\nNo screenshot attachment found for this failure.\n'
  }

  const sanitizedPath = sanitizeForMarkdownCodeBlock(ctx.screenshotPath)
  if (isHttpUrl(sanitizedPath)) {
    return `## Screenshot
![Failure screenshot](${sanitizedPath})

Source: ${sanitizedPath}
`
  }

  const runHint = ctx.runUrl ? `\nCI run artifacts: ${ctx.runUrl}` : ''

  const relativeHint = toRepoRelativeArtifactHint(sanitizedPath)
  const label = relativeHint ?? basename(sanitizedPath)
  const redactionHint = looksLikeAbsoluteWindowsPath(sanitizedPath)
    ? ' (local absolute path omitted)'
    : ''

  return `## Screenshot
Screenshot captured${redactionHint}. GitHub Issues cannot accept binary uploads via API.

Artifact reference: \`${label}\`${runHint}
`
}

const buildFingerprint = (
  ctx: FailureContext,
  classification: ClassificationResult,
): string => {
  const locatorKey =
    classification.category === 'BROKEN_LOCATOR'
      ? sanitizeForMarkdownCodeBlock(
          extractLocatorFromError(ctx) ?? 'locator-unavailable',
        ).toLowerCase()
      : ''

  const payload = [
    ctx.commit,
    ctx.testFile,
    ctx.testName,
    classification.category,
    locatorKey,
  ].join('\n')
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

const fingerprintMarker = (fingerprint: string): string =>
  `\n\n<!-- qa-agent-fp:${fingerprint} -->\n`

interface GitHubIssueListItem {
  number?: number
  html_url?: string
  body?: string | null
  pull_request?: unknown
}

interface IssueResolutionResult {
  number: number
  url: string
  created: boolean
}

const readErrorMessage = async (res: Response): Promise<string> => {
  try {
    const text = await res.text()
    const parsed = JSON.parse(text) as { message?: string }
    if (parsed.message && typeof parsed.message === 'string') {
      return parsed.message
    }
    return text.slice(0, 500)
  } catch {
    return res.statusText
  }
}

const findOpenDuplicateIssue = async (input: {
  apiBase: string
  owner: string
  repo: string
  token: string
  fingerprint: string
  labelForQuery: string
}): Promise<{ number: number; url: string } | null> => {
  const url = new URL(
    `${input.apiBase}/repos/${input.owner}/${input.repo}/issues`,
  )
  url.searchParams.set('state', 'open')
  url.searchParams.set('labels', input.labelForQuery)
  url.searchParams.set('per_page', '50')
  url.searchParams.set('sort', 'created')
  url.searchParams.set('direction', 'desc')

  const res = await fetch(url, { headers: authHeaders(input.token) })
  if (!res.ok) {
    const message = await readErrorMessage(res)
    throw new Error(
      `GitHub issues list failed (${res.status}): ${message}`,
    )
  }

  const items = (await res.json()) as GitHubIssueListItem[]
  if (!Array.isArray(items)) {
    return null
  }

  const needle = `qa-agent-fp:${input.fingerprint}`
  for (const item of items) {
    if (item.pull_request) {
      continue
    }
    if (typeof item.body === 'string' && item.body.includes(needle)) {
      if (typeof item.number === 'number' && typeof item.html_url === 'string') {
        return { number: item.number, url: item.html_url }
      }
      return null
    }
  }
  return null
}

const truncateIssueTitle = (title: string, maxLen: number): string => {
  if (title.length <= maxLen) {
    return title
  }
  if (maxLen <= 3) {
    return title.slice(0, maxLen)
  }
  return `${title.slice(0, maxLen - 3)}...`
}

const REPORT_ISSUE_CATEGORIES = [
  'BROKEN_LOCATOR',
  'REAL_BUG',
  'ENV_ISSUE',
] as const satisfies readonly FailureCategory[]

type ReportIssueCategory = (typeof REPORT_ISSUE_CATEGORIES)[number]

const isReportIssueCategory = (c: FailureCategory): c is ReportIssueCategory =>
  (REPORT_ISSUE_CATEGORIES as readonly FailureCategory[]).includes(c)

const issuePresentation = (
  category: ReportIssueCategory,
): { heading: string; titlePrefix: string } => {
  if (category === 'BROKEN_LOCATOR') {
    return {
      heading: '## Automated Automation Issue Report',
      titlePrefix: '[AUTOMATION_BUG]',
    }
  }
  if (category === 'ENV_ISSUE') {
    return {
      heading: '## Automated Environment Issue Report',
      titlePrefix: '[ENV]',
    }
  }
  return {
    heading: '## Automated Bug Report',
    titlePrefix: '[BUG]',
  }
}

const extractLocatorFromError = (ctx: FailureContext): string | null => {
  const combined = `${ctx.error}\n${ctx.errorStack}\n${ctx.playwrightErrorMessages ?? ''}`
  const locatorLine = combined.match(/Locator:\s*([^\n\r]+)/i)
  if (locatorLine && locatorLine[1]) {
    return locatorLine[1].trim()
  }
  const waitingFor = combined.match(/waiting for\s+([^\n\r]+)/i)
  if (waitingFor && waitingFor[1]) {
    return waitingFor[1].trim()
  }
  return null
}

const buildLocatorUpdateSection = (
  ctx: FailureContext,
  classification: ClassificationResult,
): string => {
  if (classification.category !== 'BROKEN_LOCATOR') {
    return ''
  }

  const locatorHint = extractLocatorFromError(ctx) ?? 'Locator not extracted from failure output.'
  const suggestedFix = classification.suggestedFix ?? 'No selector update suggestion was provided.'

  return `## Locator Update Needed
**Locator to update:** \`${sanitizeForMarkdownCodeBlock(locatorHint)}\`

**Suggested update direction:** ${sanitizeForMarkdownCodeBlock(suggestedFix)}
`
}

export const ensureIssueForFailure = async (
  ctx: FailureContext,
  classification: ClassificationResult,
  config: AgentConfig,
): Promise<IssueResolutionResult> => {
  if (!isReportIssueCategory(classification.category)) {
    throw new Error(
      `createBugIssue only supports ${REPORT_ISSUE_CATEGORIES.join(', ')}; got ${classification.category}`,
    )
  }

  const presentation = issuePresentation(classification.category)

  const token = process.env.GITHUB_TOKEN
  if (!token || token.trim() === '') {
    throw new Error('GITHUB_TOKEN is required to create a GitHub issue')
  }

  const repoFull = process.env.GITHUB_REPOSITORY
  if (!repoFull || repoFull.trim() === '') {
    throw new Error('GITHUB_REPOSITORY is required to create a GitHub issue')
  }

  const { owner, repo } = parseRepository(repoFull)
  const apiBase = getGitHubApiBase()
  const fingerprint = buildFingerprint(ctx, classification)
  const labelForQuery =
    config.github.issueLabels.find((label) => label === 'automated-qa') ??
    config.github.issueLabels[0] ??
    'automated-qa'

  const duplicate = await findOpenDuplicateIssue({
    apiBase,
    owner,
    repo,
    token,
    fingerprint,
    labelForQuery,
  })

  if (duplicate) {
    logger.info('GitHub issue skipped: open duplicate exists', {
      duplicateUrl: duplicate.url,
      issueNumber: duplicate.number,
      testFile: ctx.testFile,
      testName: ctx.testName,
      category: classification.category,
      locator:
        classification.category === 'BROKEN_LOCATOR'
          ? extractLocatorFromError(ctx) ?? 'locator-unavailable'
          : undefined,
    })
    return {
      number: duplicate.number,
      url: duplicate.url,
      created: false,
    }
  }

  const body = `${presentation.heading}

**Detected by:** Playwright QA Agent  
**Branch:** \`${ctx.branch}\`  
**Commit:** \`${ctx.commit}\`  
**CI Run:** ${ctx.runUrl}  

---

## Error
\`\`\`
${sanitizeForMarkdownCodeBlock(ctx.error)}
\`\`\`

## Stack Trace
\`\`\`
${sanitizeForMarkdownCodeBlock(ctx.errorStack)}
\`\`\`

${buildScreenshotSection(ctx)}

${buildLocatorUpdateSection(ctx, classification)}

## Classification
| Field | Value |
|---|---|
| Category | ${classification.category} |
| Confidence | ${classification.confidence} |
| Reason | ${classification.reason} |

## Failing Test
**File:** \`${ctx.testFile}\`  
**Test:** ${ctx.testName}

---
*Auto-generated. Verify before acting on this issue.*${fingerprintMarker(fingerprint)}`

  const issueTitleClean = classification.issueTitle
    .replace(/[\u2014\u2013]/g, ':')
    .replace(/\s+/g, ' ')
    .trim()

  const rawTitle = `${presentation.titlePrefix} ${issueTitleClean}`
  const title = truncateIssueTitle(rawTitle, 120)

  const createUrl = `${apiBase}/repos/${owner}/${repo}/issues`
  const res = await fetch(createUrl, {
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title,
      body,
      labels: config.github.issueLabels,
    }),
  })

  const data = (await res.json()) as { number?: number; html_url?: string; message?: string }

  if (!res.ok) {
    const message = data.message ?? (await readErrorMessage(res))
    throw new Error(`GitHub issue create failed (${res.status}): ${message}`)
  }

  if (typeof data.number === 'number' && typeof data.html_url === 'string') {
    logger.info('GitHub issue created', {
      issueNumber: data.number,
      htmlUrl: data.html_url,
      category: classification.category,
    })
    return {
      number: data.number,
      url: data.html_url,
      created: true,
    }
  }

  logger.warn('GitHub issue response missing html_url', {
    status: res.status,
    category: classification.category,
  })
  throw new Error('GitHub issue create response missing required number/html_url')
}

export const createBugIssue = async (
  ctx: FailureContext,
  classification: ClassificationResult,
  config: AgentConfig,
): Promise<void> => {
  await ensureIssueForFailure(ctx, classification, config)
}
