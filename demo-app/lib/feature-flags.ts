import type { QaFlag, QaFlagsConfig } from '@/lib/types'

const parseFlagsConfig = (): QaFlagsConfig | null => {
  const rawConfig = process.env.NEXT_PUBLIC_QA_FLAGS
  if (!rawConfig) {
    return null
  }

  try {
    const parsed = JSON.parse(rawConfig) as QaFlagsConfig
    if (!Array.isArray(parsed.flags)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

const getSeed = (): string => {
  if (typeof window === 'undefined') {
    return 'server'
  }

  const seedSource = process.env.NEXT_PUBLIC_QA_FLAGS_SEED_SOURCE
  if (!seedSource) {
    return 'client-default'
  }

  if (seedSource.startsWith('query:')) {
    const paramName = seedSource.slice('query:'.length)
    const url = new URL(window.location.href)
    return url.searchParams.get(paramName) ?? 'query-missing'
  }

  if (seedSource.startsWith('header:')) {
    const headerName = seedSource.slice('header:'.length)
    const marker = `qa-seed-${headerName}`
    return window.localStorage.getItem(marker) ?? 'header-missing'
  }

  return 'client-default'
}

const hashToPercent = (input: string): number => {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index)
    hash |= 0
  }
  const positive = Math.abs(hash)
  return positive % 100
}

const evaluateFlag = (flag: QaFlag): boolean => {
  if (flag.mode === 'fixed') {
    return flag.enabled === true
  }

  const chance = flag.chance ?? 0
  if (chance <= 0) {
    return false
  }
  if (chance >= 100) {
    return true
  }

  const seed = getSeed()
  const percent = hashToPercent(`${seed}:${flag.key}`)
  return percent < chance
}

export const isQaFlagEnabled = (flagKey: string): boolean => {
  const config = parseFlagsConfig()
  if (!config) {
    return false
  }

  const flag = config.flags.find((item) => item.key === flagKey)
  if (!flag) {
    return false
  }

  return evaluateFlag(flag)
}

