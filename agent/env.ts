import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from './logger.js'

/** Directory containing this module (`agent/`). */
const agentDir = dirname(fileURLToPath(import.meta.url))

const stripUtf8Bom = (content: string): string => {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
}

const parseEnvLine = (line: string): [string, string] | null => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) {
    return null
  }

  const separatorIndex = trimmed.indexOf('=')
  if (separatorIndex <= 0) {
    return null
  }

  const key = trimmed.slice(0, separatorIndex).trim()
  if (!key) {
    return null
  }

  let value = trimmed.slice(separatorIndex + 1).trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }

  return [key, value]
}

/**
 * .env lines sometimes include only a leading quote (e.g. KEY='value without a
 * closing quote). parseEnvLine only strips fully wrapped values, so stray quotes
 * must be removed here or GitHub API auth fails with 401 Bad credentials.
 */
export const stripEnvQuotes = (value: string): string => {
  let t = value.trim()
  if (t.length >= 2) {
    const open = t[0]
    const close = t[t.length - 1]
    if ((open === "'" && close === "'") || (open === '"' && close === '"')) {
      t = t.slice(1, -1).trim()
    }
  }
  if (t.startsWith("'") || t.startsWith('"')) {
    t = t.slice(1).trim()
  }
  if (t.endsWith("'") || t.endsWith('"')) {
    t = t.slice(0, -1).trim()
  }
  return t
}

const loadEnvFromFile = (path: string): number => {
  if (!existsSync(path)) {
    return 0
  }

  const content = stripUtf8Bom(readFileSync(path, 'utf-8'))
  const lines = content.split(/\r?\n/)
  let loaded = 0

  for (const line of lines) {
    const parsed = parseEnvLine(line)
    if (!parsed) {
      continue
    }

    const [key, value] = parsed
    // Keep existing non-empty env values highest precedence (shell exports win).
    const existing = process.env[key]
    if (existing !== undefined && existing !== '') {
      continue
    }

    process.env[key] = value
    loaded += 1
  }

  return loaded
}

/**
 * Last assignment wins (same as many dotenv loaders) so duplicate keys in a file
 * behave predictably.
 */
export const readLastValueForKeyFromFile = (
  filePath: string,
  key: string,
): string | null => {
  if (!existsSync(filePath)) {
    return null
  }
  const lines = stripUtf8Bom(readFileSync(filePath, 'utf-8')).split(/\r?\n/)
  let last: string | null = null
  for (const line of lines) {
    const parsed = parseEnvLine(line)
    if (parsed && parsed[0] === key) {
      last = parsed[1]
    }
  }
  return last
}

/**
 * Merge GitHub vars from `.env` files when not in CI.
 *
 * - **Default:** Only fill `GITHUB_TOKEN` / `GITHUB_REPOSITORY` when they are
 *   still empty after the normal load (so a working PowerShell token is not
 *   replaced by a stale line in `.env`).
 * - **Stale shell token:** Set `AGENT_DOTENV_OVERRIDES_SHELL_GITHUB=true` so
 *   values from repo-root then `agent/.env` (later file wins) replace shell.
 * - **Opt out:** `AGENT_SKIP_REPO_ROOT_GITHUB_DOTENV=true` disables this merge.
 */
const applyGithubFromDotenvFilesWhenLocal = (): boolean => {
  if (process.env.CI === 'true') {
    return false
  }
  if (process.env.AGENT_SKIP_REPO_ROOT_GITHUB_DOTENV === 'true') {
    return false
  }
  const paths = [resolve(agentDir, '..', '.env'), resolve(agentDir, '.env')]
  let lastTok: string | null = null
  let lastRepo: string | null = null
  for (const p of paths) {
    const t = readLastValueForKeyFromFile(p, 'GITHUB_TOKEN')
    const r = readLastValueForKeyFromFile(p, 'GITHUB_REPOSITORY')
    if (t) {
      lastTok = t
    }
    if (r) {
      lastRepo = r
    }
  }

  const forceShellOverride =
    process.env.AGENT_DOTENV_OVERRIDES_SHELL_GITHUB === 'true'
  const hasToken = Boolean(process.env.GITHUB_TOKEN?.trim())
  const hasRepo = Boolean(process.env.GITHUB_REPOSITORY?.trim())

  let applied = false

  if (forceShellOverride) {
    if (lastTok) {
      process.env.GITHUB_TOKEN = stripEnvQuotes(lastTok)
      applied = true
    }
    if (lastRepo) {
      process.env.GITHUB_REPOSITORY = stripEnvQuotes(lastRepo)
      applied = true
    }
    return applied
  }

  if (!hasToken && lastTok) {
    process.env.GITHUB_TOKEN = stripEnvQuotes(lastTok)
    applied = true
  }
  if (!hasRepo && lastRepo) {
    process.env.GITHUB_REPOSITORY = stripEnvQuotes(lastRepo)
    applied = true
  }
  return applied
}

export const loadEnvForAgent = (): void => {
  // Resolve from this file so loading works whether the shell cwd is the repo root
  // (npm run agent) or agent/ (tsx orchestrator.ts). Repo root first, then agent/.env
  // so local overrides win only when the same key is not already set.
  const fromPackage = [
    resolve(agentDir, '..', '.env'),
    resolve(agentDir, '.env'),
  ]
  const fromCwd = [resolve(process.cwd(), '.env')]
  const candidates = [...new Set([...fromPackage, ...fromCwd])]

  let loadedTotal = 0
  for (const candidate of candidates) {
    loadedTotal += loadEnvFromFile(candidate)
  }

  if (process.env.GITHUB_TOKEN) {
    process.env.GITHUB_TOKEN = stripEnvQuotes(process.env.GITHUB_TOKEN)
  }
  if (process.env.GITHUB_REPOSITORY) {
    process.env.GITHUB_REPOSITORY = stripEnvQuotes(process.env.GITHUB_REPOSITORY)
  }

  const appliedGithubDotenv = applyGithubFromDotenvFilesWhenLocal()
  if (appliedGithubDotenv) {
    const forced = process.env.AGENT_DOTENV_OVERRIDES_SHELL_GITHUB === 'true'
    logger.info(
      forced
        ? 'GitHub env vars loaded from .env files (AGENT_DOTENV_OVERRIDES_SHELL_GITHUB=true; replaced shell).'
        : 'Filled missing GITHUB_TOKEN / GITHUB_REPOSITORY from .env files. To replace a working shell token with .env, set AGENT_DOTENV_OVERRIDES_SHELL_GITHUB=true.',
    )
  }

  const tokenPresent = Boolean(process.env.GITHUB_TOKEN?.trim())
  const repoPresent = Boolean(process.env.GITHUB_REPOSITORY?.trim())

  logger.debug('Environment loading complete', {
    loadedKeys: loadedTotal,
    searchedPaths: candidates,
    githubTokenPresent: tokenPresent,
    githubRepositoryPresent: repoPresent,
    githubDotenvOverrideApplied: appliedGithubDotenv,
  })
}

