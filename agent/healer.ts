import { logger } from './logger.js'
import { getAgentConfig } from './config.js'
import { getLlmClient } from './llm/factory.js'
import { ensureIssueForFailure } from './reporter.js'
import type { ClassificationResult, FailureContext } from './types.js'

const GITHUB_API_VERSION = '2022-11-28'

interface GitHubRefResponse {
  object?: { sha?: string }
}

interface GitHubContentResponse {
  sha?: string
  content?: string
  encoding?: string
}

interface GitHubTreeNode {
  path?: string
  type?: string
}

interface GitHubTreeResponse {
  tree?: GitHubTreeNode[]
}

interface RepoFileData {
  path: string
  sha: string
  source: string
}

interface HealerFixResponse {
  targetFile: string
  updatedSource: string
  originalLocator?: string
  newLocator?: string
}

interface IdentifierRename {
  from: string
  to: string
}

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
    throw new Error('GITHUB_REPOSITORY must be "owner/repo"')
  }
  return { owner: parts[0], repo: parts[1] }
}

const authHeaders = (token: string): Record<string, string> => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': GITHUB_API_VERSION,
})

const sanitizeBranchSegment = (value: string): string => {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return cleaned.slice(0, 40) || 'test'
}

const trimCodeFences = (value: string): string => {
  const trimmed = value.trim()
  const fenced = trimmed.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/)
  if (!fenced || !fenced[1]) {
    return trimmed
  }
  return fenced[1].trim()
}

const normalizeJsonCandidate = (raw: string): string => {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const base = fenced?.[1] ?? trimmed
  const start = base.indexOf('{')
  if (start < 0) {
    return base
  }
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < base.length; i += 1) {
    const ch = base[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      depth += 1
      continue
    }
    if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        return base.slice(start, i + 1).trim()
      }
    }
  }
  return base
}

const stripAnsi = (value: string): string => {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}

const stripUnsafeControlChars = (value: string): string => {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
}

const sanitizeForMarkdown = (value: string): string => {
  return stripUnsafeControlChars(stripAnsi(value)).trim()
}

const extractLocatorFromError = (ctx: FailureContext): string | null => {
  const combined = `${ctx.error}\n${ctx.errorStack}\n${ctx.playwrightErrorMessages ?? ''}`
  const locatorLine = combined.match(/Locator:\s*([^\n\r]+)/i)
  if (locatorLine?.[1]) {
    return locatorLine[1].trim()
  }
  const waitingFor = combined.match(/waiting for\s+([^\n\r]+)/i)
  if (waitingFor?.[1]) {
    return waitingFor[1].trim()
  }
  return null
}

const extractPomTargets = (source: string): string[] => {
  const matches = Array.from(source.matchAll(/from\s+['"]\.\.\/pom\/([^'"]+)['"]/g))
  const targets = matches
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => `tests/pom/${value}.ts`)
  return Array.from(new Set(targets))
}

const extractQuotedValues = (value: string): string[] => {
  const matches = Array.from(value.matchAll(/'([^']+)'|"([^"]+)"/g))
  return matches
    .map((match) => match[1] ?? match[2] ?? '')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

const inferLocatorChange = (
  ctx: FailureContext,
  classification: ClassificationResult,
): { original: string; proposed: string } => {
  const original = extractLocatorFromError(ctx) ?? 'unavailable'
  const suggested = classification.suggestedFix ?? ''
  const quoted = extractQuotedValues(suggested)

  if (quoted.length >= 2) {
    return {
      original: quoted[0],
      proposed: quoted[1],
    }
  }
  if (quoted.length === 1) {
    return {
      original,
      proposed: quoted[0],
    }
  }
  return {
    original,
    proposed: 'unavailable',
  }
}

const similarityScore = (before: string, after: string): number => {
  const beforeLines = before.split(/\r?\n/)
  const afterLines = after.split(/\r?\n/)
  const beforeSet = new Set(beforeLines.map((line) => line.trim()).filter(Boolean))
  if (beforeSet.size === 0) {
    return 0
  }
  let shared = 0
  for (const line of afterLines) {
    if (beforeSet.has(line.trim())) {
      shared += 1
    }
  }
  return shared / Math.max(beforeSet.size, 1)
}

const extractTestId = (value: string): string | null => {
  const match = value.match(/['"]([^'"]+)['"]/)
  if (match?.[1]) {
    return match[1].trim()
  }
  const plainToken = value.match(/[A-Za-z0-9_-]{3,}/)
  return plainToken?.[0] ?? null
}

const extractIdentifier = (value: string): string | null => {
  const clean = value.trim()
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(clean)) {
    return clean
  }
  return null
}

const inferIdentifierRename = (
  originalLocator: string | undefined,
  newLocator: string | undefined,
): IdentifierRename | null => {
  const from = extractIdentifier(originalLocator ?? '')
  const to = extractIdentifier(newLocator ?? '')
  if (!from || !to || from === to) {
    return null
  }
  return { from, to }
}

const extractUsedCalls = (source: string): Set<string> => {
  const matches = Array.from(source.matchAll(/\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g))
  return new Set(matches.map((match) => match[1]))
}

const suggestCompatibleCall = (
  unsupportedCall: string,
  allowedCalls: Set<string>,
): string | null => {
  if (allowedCalls.has(unsupportedCall)) {
    return unsupportedCall
  }
  if (unsupportedCall.startsWith('get') && unsupportedCall.length > 3) {
    const candidate = `${unsupportedCall[3].toLowerCase()}${unsupportedCall.slice(4)}`
    if (allowedCalls.has(candidate)) {
      return candidate
    }
  }
  const lowerUnsupported = unsupportedCall.toLowerCase()
  const suffixMatch = Array.from(allowedCalls).find(
    (call) =>
      call.toLowerCase().endsWith(lowerUnsupported) ||
      lowerUnsupported.endsWith(call.toLowerCase()),
  )
  return suffixMatch ?? null
}

const normalizeUnsupportedApiCalls = (before: string, after: string): string => {
  const beforeCalls = extractUsedCalls(before)
  const afterCalls = extractUsedCalls(after)
  const unsupported = Array.from(afterCalls).filter((call) => !beforeCalls.has(call))
  if (unsupported.length === 0) {
    return after
  }

  let normalized = after
  for (const call of unsupported) {
    const replacement = suggestCompatibleCall(call, beforeCalls)
    if (!replacement || replacement === call) {
      continue
    }
    const escapedCall = call.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    normalized = normalized.replace(
      new RegExp(`\\.${escapedCall}\\s*\\(`, 'g'),
      `.${replacement}(`,
    )
  }
  return normalized
}

const assertNoUnsupportedApiCalls = (before: string, after: string): void => {
  const beforeCalls = extractUsedCalls(before)
  const afterCalls = extractUsedCalls(after)
  for (const call of afterCalls) {
    if (!beforeCalls.has(call)) {
      throw new Error(
        `Healer introduced unsupported call ".${call}()" not present in target file`,
      )
    }
  }
}

const assertNoAddedComments = (before: string, after: string): void => {
  const beforeLines = new Set(before.split(/\r?\n/))
  const addedLines = after
    .split(/\r?\n/)
    .filter((line) => !beforeLines.has(line))
    .map((line) => line.trim())
  const hasAddedComment = addedLines.some(
    (line) => line.startsWith('//') || line.includes('//'),
  )
  if (hasAddedComment) {
    throw new Error('Healer added inline comments, which are not allowed')
  }
}

const buildHealerPrTitle = (input: {
  ctx: FailureContext
  targetFile: string
  locatorFrom: string
  locatorTo: string
}): string => {
  const targetName =
    input.targetFile.split('/').pop()?.replace(/\.ts$/, '') ?? input.targetFile
  const fromTestId = extractTestId(input.locatorFrom)
  const toTestId = extractTestId(input.locatorTo)
  const locatorSummary =
    fromTestId && toTestId
      ? `${fromTestId}->${toTestId}`
      : fromTestId
        ? `locator ${fromTestId}`
        : toTestId
          ? `locator ${toTestId}`
          : `locator ${input.ctx.testName}`
  const raw = `fix(tests): ${targetName} ${locatorSummary}`
  return raw.length <= 120 ? raw : `${raw.slice(0, 117)}...`
}

const extractTestIdValuesFromSource = (source: string): string[] => {
  const matches = Array.from(source.matchAll(/byTestId\(\s*['"]([^'"]+)['"]\s*\)/g))
  return matches
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
}

const inferLocatorDeltaFromSource = (
  before: string,
  after: string,
  fallback: { original: string; proposed: string },
): { original: string; proposed: string } => {
  const beforeIds = extractTestIdValuesFromSource(before)
  const afterIds = extractTestIdValuesFromSource(after)
  const removed = beforeIds.find((id) => !afterIds.includes(id))
  const added = afterIds.find((id) => !beforeIds.includes(id))
  if (removed && added) {
    return {
      original: removed,
      proposed: added,
    }
  }
  return fallback
}

const escapeRegex = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const applyDeterministicLocatorReplace = (
  source: string,
  originalLocator: string,
  proposedLocator: string,
): string => {
  const original = originalLocator.trim()
  const proposed = proposedLocator.trim()
  if (!original || !proposed || original === proposed) {
    return source
  }

  const candidates = [original]
  const originalTestId = extractTestId(original)
  const proposedTestId = extractTestId(proposed)
  if (originalTestId && proposedTestId && originalTestId !== proposedTestId) {
    candidates.push(`'${originalTestId}'`)
    candidates.push(`"${originalTestId}"`)
  }

  let updated = source
  for (const candidate of candidates) {
    if (!updated.includes(candidate)) {
      continue
    }
    if (candidate === `'${originalTestId}'` || candidate === `"${originalTestId}"`) {
      const quote = candidate[0]
      const replacement = `${quote}${proposedTestId ?? originalTestId}${quote}`
      updated = updated.replace(
        new RegExp(escapeRegex(candidate), 'g'),
        replacement,
      )
    } else {
      updated = updated.replace(
        new RegExp(escapeRegex(candidate), 'g'),
        proposed,
      )
    }
  }
  return updated
}

const normalizePath = (value: string): string => value.replace(/\\/g, '/')

const resolveTargetFilePath = async (input: {
  apiBase: string
  owner: string
  repo: string
  token: string
  baseSha: string
  rawFilePath: string
}): Promise<string> => {
  const filePath = normalizePath(input.rawFilePath)
  if (filePath.includes('/')) {
    return filePath
  }

  const treeRes = await fetch(
    `${input.apiBase}/repos/${input.owner}/${input.repo}/git/trees/${input.baseSha}?recursive=1`,
    { headers: authHeaders(input.token) },
  )
  if (!treeRes.ok) {
    throw new Error(
      `Failed to read repository tree for file resolution: ${treeRes.status} ${await getErrorMessage(treeRes)}`,
    )
  }

  const treeData = (await treeRes.json()) as GitHubTreeResponse
  const nodes = treeData.tree ?? []
  const matches = nodes
    .filter((node) => node.type === 'blob' && typeof node.path === 'string')
    .map((node) => node.path as string)
    .filter((path) => path.endsWith(`/${filePath}`) || path === filePath)

  if (matches.length === 0) {
    return filePath
  }

  const preferred =
    matches.find((path) => path.startsWith('tests/showcase/')) ??
    matches.find((path) => path.startsWith('tests/')) ??
    matches.sort((a, b) => a.length - b.length)[0]

  return preferred
}

const getErrorMessage = async (res: Response): Promise<string> => {
  try {
    const data = (await res.json()) as { message?: string }
    if (typeof data.message === 'string' && data.message.length > 0) {
      return data.message
    }
  } catch {
    // Fall through to status text
  }
  return res.statusText
}

const fetchRepoFile = async (input: {
  apiBase: string
  owner: string
  repo: string
  token: string
  path: string
}): Promise<RepoFileData> => {
  const res = await fetch(
    `${input.apiBase}/repos/${input.owner}/${input.repo}/contents/${input.path}`,
    { headers: authHeaders(input.token) },
  )
  if (!res.ok) {
    throw new Error(
      `Failed to read file ${input.path}: ${res.status} ${await getErrorMessage(res)}`,
    )
  }
  const data = (await res.json()) as GitHubContentResponse
  if (!data.sha || !data.content) {
    throw new Error(`Missing sha/content for file ${input.path}`)
  }
  const source =
    data.encoding === 'base64'
      ? Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8')
      : data.content
  return {
    path: input.path,
    sha: data.sha,
    source,
  }
}

const parseHealerFixResponse = (
  raw: string,
  allowedTargets: Set<string>,
): HealerFixResponse => {
  const parseJsonShape = (): HealerFixResponse => {
    const normalized = normalizeJsonCandidate(raw)
    const parsed = JSON.parse(normalized) as Partial<HealerFixResponse>
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Healer output must be a JSON object')
    }
    if (typeof parsed.targetFile !== 'string' || parsed.targetFile.trim() === '') {
      throw new Error('Healer output targetFile must be a non-empty string')
    }
    const targetFile = normalizePath(parsed.targetFile.trim())
    if (!allowedTargets.has(targetFile)) {
      throw new Error(`Healer selected unsupported target file: ${targetFile}`)
    }
    if (typeof parsed.updatedSource !== 'string' || parsed.updatedSource.trim() === '') {
      throw new Error('Healer output updatedSource must be non-empty')
    }
    return {
      targetFile,
      updatedSource: trimCodeFences(parsed.updatedSource),
      originalLocator: parsed.originalLocator,
      newLocator: parsed.newLocator,
    }
  }

  const parseTaggedShape = (): HealerFixResponse => {
    const targetFileMatch = raw.match(/^\s*TARGET_FILE:\s*(.+)\s*$/im)
    const targetFile = normalizePath(targetFileMatch?.[1]?.trim() ?? '')
    if (!targetFile) {
      throw new Error('Tagged healer output missing TARGET_FILE')
    }
    if (!allowedTargets.has(targetFile)) {
      throw new Error(`Healer selected unsupported target file: ${targetFile}`)
    }
    const sourceMatch = raw.match(
      /UPDATED_SOURCE_START\s*([\s\S]*?)\s*UPDATED_SOURCE_END/i,
    )
    const updatedSource = trimCodeFences(sourceMatch?.[1]?.trim() ?? '')
    if (!updatedSource) {
      throw new Error('Tagged healer output missing UPDATED_SOURCE block')
    }
    const originalLocatorMatch = raw.match(/^\s*ORIGINAL_LOCATOR:\s*(.*)\s*$/im)
    const newLocatorMatch = raw.match(/^\s*NEW_LOCATOR:\s*(.*)\s*$/im)
    return {
      targetFile,
      updatedSource,
      originalLocator: originalLocatorMatch?.[1]?.trim() || undefined,
      newLocator: newLocatorMatch?.[1]?.trim() || undefined,
    }
  }

  try {
    return parseJsonShape()
  } catch (jsonError) {
    try {
      const parsed = parseTaggedShape()
      logger.warn('Healer response required tagged-format fallback parsing', {
        parseError: jsonError instanceof Error ? jsonError.message : String(jsonError),
      })
      return parsed
    } catch {
      throw jsonError
    }
  }
}

export const healAndOpenPr = async (
  ctx: FailureContext,
  classification: ClassificationResult,
): Promise<void> => {
  const config = getAgentConfig()
  const llm = getLlmClient(config)
  const token = process.env.GITHUB_TOKEN
  const repoFull = process.env.GITHUB_REPOSITORY

  if (!token || token.trim() === '') {
    throw new Error('GITHUB_TOKEN is required for healer PR flow')
  }
  if (!repoFull || repoFull.trim() === '') {
    throw new Error('GITHUB_REPOSITORY is required for healer PR flow')
  }

  const { owner, repo } = parseRepository(repoFull)
  const apiBase = getGitHubApiBase()
  const locatorChange = inferLocatorChange(ctx, classification)

  const baseRefRes = await fetch(
    `${apiBase}/repos/${owner}/${repo}/git/ref/heads/${config.github.baseBranch}`,
    { headers: authHeaders(token) },
  )
  if (!baseRefRes.ok) {
    throw new Error(
      `Failed to read base branch ref: ${baseRefRes.status} ${await getErrorMessage(baseRefRes)}`,
    )
  }
  const baseRef = (await baseRefRes.json()) as GitHubRefResponse
  const baseSha = baseRef.object?.sha
  if (!baseSha) {
    throw new Error('Base branch SHA missing from GitHub ref response')
  }

  const targetFilePath = await resolveTargetFilePath({
    apiBase,
    owner,
    repo,
    token,
    baseSha,
    rawFilePath: ctx.testFile,
  })

  const specFile = await fetchRepoFile({
    apiBase,
    owner,
    repo,
    token,
    path: targetFilePath,
  })
  const pomTargets = extractPomTargets(specFile.source)
  const pomResults = await Promise.all(
    pomTargets.map(async (path) => {
      try {
        return await fetchRepoFile({ apiBase, owner, repo, token, path })
      } catch {
        return null
      }
    }),
  )
  const pomFiles = pomResults.filter((file): file is RepoFileData => Boolean(file))
  const allowedTargets = new Set<string>([
    specFile.path,
    ...pomFiles.map((file) => file.path),
  ])

  const candidateSources = [
    `### ${specFile.path}\n${specFile.source}`,
    ...pomFiles.map((file) => `### ${file.path}\n${file.source}`),
  ].join('\n\n')

  const fixPrompt = `You are a Playwright expert. A test has a broken locator.
Apply the SMALLEST POSSIBLE EDIT to exactly one allowed file.

Failing test metadata:
- testFile: ${ctx.testFile}
- testName: ${ctx.testName}
- classification reason: ${classification.reason}
- suggested fix direction: ${classification.suggestedFix ?? 'none'}
- original locator signal: ${locatorChange.original}
- target locator hint: ${locatorChange.proposed}

Allowed target files (pick exactly one):
${Array.from(allowedTargets).map((file) => `- ${file}`).join('\n')}

Rules:
- Keep all unrelated code unchanged.
- Do not delete tests/imports/helpers unrelated to the broken locator.
- If the locator belongs in a page object, update that page object file instead of the spec.
- Use only helper methods/APIs already present in the selected target file. Do not invent new method names.
- Do not add comments.
- Output in this exact tagged format (no extra prose):
TARGET_FILE: <one allowed target file>
ORIGINAL_LOCATOR: <locator before change>
NEW_LOCATOR: <locator after change>
UPDATED_SOURCE_START
<complete updated source for target file>
UPDATED_SOURCE_END

Current sources:
${candidateSources}`

  logger.info('Healer generating fix', {
    testFile: ctx.testFile,
    resolvedSpecPath: specFile.path,
    pomCandidates: pomFiles.map((file) => file.path),
    testName: ctx.testName,
    model: config.llm.model,
  })

  const generated = await llm.generateFix({
    prompt: fixPrompt,
    maxTokens: config.llm.maxTokens.heal,
    temperature: config.llm.temperature.heal,
  })
  const fix = parseHealerFixResponse(generated, allowedTargets)
  const selectedFile =
    fix.targetFile === specFile.path
      ? specFile
      : pomFiles.find((file) => file.path === fix.targetFile)
  if (!selectedFile) {
    throw new Error(`Selected target file metadata missing for ${fix.targetFile}`)
  }
  const supportedCalls = Array.from(extractUsedCalls(selectedFile.source)).sort()

  const refinePrompt = `You produced an update for ${fix.targetFile}. Rewrite it so it only uses methods already present in that file.

Allowed method calls in ${fix.targetFile}:
${supportedCalls.map((call) => `- ${call}`).join('\n')}

Strict rules:
- Do not introduce any method call not listed above.
- Keep behavior the same as your intended locator fix.
- Do not add comments.
- Return only the full corrected source code for ${fix.targetFile}.`

  const refinedGenerated = await llm.generateFix({
    prompt:
      `${refinePrompt}\n\nCurrent candidate source:\n${fix.updatedSource}`,
    maxTokens: config.llm.maxTokens.heal,
    temperature: config.llm.temperature.heal,
  })

  const refinedSource = trimCodeFences(refinedGenerated) || fix.updatedSource
  const score = similarityScore(selectedFile.source, refinedSource)
  if (score < 0.65) {
    throw new Error(
      `Healer generated overly broad rewrite for ${fix.targetFile} (similarity=${score.toFixed(2)}). Aborting unsafe commit.`,
    )
  }
  const rename = inferIdentifierRename(fix.originalLocator, fix.newLocator)
  const identifierNormalizedSource =
    rename !== null
      ? refinedSource.replace(
          new RegExp(`\\b${rename.to}\\b`, 'g'),
          rename.from,
        )
      : refinedSource
  const callNormalizedSource = normalizeUnsupportedApiCalls(
    selectedFile.source,
    identifierNormalizedSource,
  )
  assertNoUnsupportedApiCalls(selectedFile.source, callNormalizedSource)
  const modelLocatorFallback = {
    original: fix.originalLocator ?? locatorChange.original,
    proposed: fix.newLocator ?? locatorChange.proposed,
  }
  const sourceWithDeterministicFallback =
    callNormalizedSource === selectedFile.source
      ? applyDeterministicLocatorReplace(
          selectedFile.source,
          modelLocatorFallback.original,
          modelLocatorFallback.proposed,
        )
      : callNormalizedSource
  assertNoUnsupportedApiCalls(selectedFile.source, sourceWithDeterministicFallback)
  assertNoAddedComments(selectedFile.source, sourceWithDeterministicFallback)
  if (sourceWithDeterministicFallback === selectedFile.source) {
    throw new Error(
      `Healer produced no effective code change for ${fix.targetFile}; refusing to open PR`,
    )
  }
  const effectiveLocatorChange = inferLocatorDeltaFromSource(
    selectedFile.source,
    sourceWithDeterministicFallback,
    modelLocatorFallback,
  )

  const issue = await ensureIssueForFailure(ctx, classification, config)

  const branchName = `fix/auto-heal-${sanitizeBranchSegment(ctx.testName)}-${Date.now()}`
  const createBranchRes = await fetch(`${apiBase}/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    }),
  })
  if (!createBranchRes.ok) {
    throw new Error(
      `Failed to create healer branch: ${createBranchRes.status} ${await getErrorMessage(createBranchRes)}`,
    )
  }

  const updateRes = await fetch(
    `${apiBase}/repos/${owner}/${repo}/contents/${fix.targetFile}`,
    {
      method: 'PUT',
      headers: {
        ...authHeaders(token),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: `fix(tests): auto-heal broken locator in "${ctx.testName}"`,
        content: Buffer.from(sourceWithDeterministicFallback, 'utf8').toString('base64'),
        sha: selectedFile.sha,
        branch: branchName,
      }),
    },
  )
  if (!updateRes.ok) {
    throw new Error(
      `Failed to commit healed file: ${updateRes.status} ${await getErrorMessage(updateRes)}`,
    )
  }

  const prRes = await fetch(`${apiBase}/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title: buildHealerPrTitle({
        ctx,
        targetFile: fix.targetFile,
        locatorFrom: effectiveLocatorChange.original,
        locatorTo: effectiveLocatorChange.proposed,
      }),
      body:
        `## Auto-Generated Heal PR\n\n` +
        `**Failure:** ${sanitizeForMarkdown(ctx.error)}\n` +
        `**Reason:** ${sanitizeForMarkdown(classification.reason)}\n` +
        `**Confidence:** ${classification.confidence}\n` +
        `**CI Run:** ${ctx.runUrl}\n` +
        `**Target file updated:** ${fix.targetFile}\n` +
        `**Original locator:** ${sanitizeForMarkdown(effectiveLocatorChange.original)}\n` +
        `**Proposed locator:** ${sanitizeForMarkdown(effectiveLocatorChange.proposed)}\n` +
        `**Linked issue:** #${issue.number}\n\n` +
        `Closes #${issue.number}\n\n` +
        `> Review before merging — verify locator updates are correct.`,
      head: branchName,
      base: config.github.baseBranch,
    }),
  })
  if (!prRes.ok) {
    throw new Error(
      `Failed to open healer PR: ${prRes.status} ${await getErrorMessage(prRes)}`,
    )
  }

  const prData = (await prRes.json()) as { html_url?: string; number?: number }
  logger.info('Healer PR opened', {
    branchName,
    prNumber: prData.number,
    prUrl: prData.html_url,
    linkedIssueNumber: issue.number,
    linkedIssueCreated: issue.created,
    targetFilePath: fix.targetFile,
  })
}

