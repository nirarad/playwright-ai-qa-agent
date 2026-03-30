import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { logger } from './logger.js'

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
    // Keep existing env values highest precedence.
    if (process.env[key] !== undefined) {
      continue
    }

    process.env[key] = value
    loaded += 1
  }

  return loaded
}

export const loadEnvForAgent = (): void => {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '..', '.env'),
  ]

  let loadedTotal = 0
  for (const candidate of candidates) {
    loadedTotal += loadEnvFromFile(candidate)
  }

  logger.debug('Environment loading complete', {
    loadedKeys: loadedTotal,
    searchedPaths: candidates,
  })
}

