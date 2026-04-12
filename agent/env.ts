import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from './logger.js'

/** Directory containing this module (`agent/`). */
const agentDir = dirname(fileURLToPath(import.meta.url))

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

const loadEnvFromFile = (path: string): number => {
  if (!existsSync(path)) {
    return 0
  }

  const content = readFileSync(path, 'utf-8')
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
    process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN.trim()
  }
  if (process.env.GITHUB_REPOSITORY) {
    process.env.GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY.trim()
  }

  const tokenPresent = Boolean(process.env.GITHUB_TOKEN?.trim())
  const repoPresent = Boolean(process.env.GITHUB_REPOSITORY?.trim())

  logger.debug('Environment loading complete', {
    loadedKeys: loadedTotal,
    searchedPaths: candidates,
    githubTokenPresent: tokenPresent,
    githubRepositoryPresent: repoPresent,
  })
}

