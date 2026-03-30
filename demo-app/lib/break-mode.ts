import type { BreakMode } from '@/lib/types'

const BREAK_KEY = 'demo_break_mode'
const BREAK_MODE_EVENT = 'demo-break-mode-changed'

const allowedModes: BreakMode[] = [
  'none',
  'selector-change',
  'logic-bug',
  'slow-network',
  'auth-break',
]

const isAllowedMode = (value: string | null): value is BreakMode => {
  if (!value) {
    return false
  }
  return allowedModes.includes(value as BreakMode)
}

export const getBreakMode = (): BreakMode => {
  if (typeof window === 'undefined') {
    return 'none'
  }

  let rawMode: string | null = null
  try {
    rawMode = sessionStorage.getItem(BREAK_KEY)
  } catch {
    return 'none'
  }

  if (!isAllowedMode(rawMode)) {
    return 'none'
  }
  return rawMode
}

export const setBreakMode = (mode: BreakMode): void => {
  if (typeof window === 'undefined') {
    return
  }
  try {
    sessionStorage.setItem(BREAK_KEY, mode)
  } catch {
    return
  }
  window.dispatchEvent(
    new CustomEvent<BreakMode>(BREAK_MODE_EVENT, {
      detail: mode,
    }),
  )
}

export const bootstrapBreakModeFromUrl = (): BreakMode => {
  if (typeof window === 'undefined') {
    return 'none'
  }

  const url = new URL(window.location.href)
  const requestedMode = url.searchParams.get('qaMode')

  if (!isAllowedMode(requestedMode)) {
    return getBreakMode()
  }

  setBreakMode(requestedMode)
  url.searchParams.delete('qaMode')
  window.history.replaceState({}, '', url.toString())
  return requestedMode
}

export const onBreakModeChange = (listener: (mode: BreakMode) => void) => {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const handleStorageChange = (event: StorageEvent) => {
    if (event.key !== BREAK_KEY) {
      return
    }
    listener(getBreakMode())
  }

  const handleCustomChange = (event: Event) => {
    const customEvent = event as CustomEvent<BreakMode>
    listener(customEvent.detail ?? getBreakMode())
  }

  window.addEventListener('storage', handleStorageChange)
  window.addEventListener(BREAK_MODE_EVENT, handleCustomChange)

  return () => {
    window.removeEventListener('storage', handleStorageChange)
    window.removeEventListener(BREAK_MODE_EVENT, handleCustomChange)
  }
}

