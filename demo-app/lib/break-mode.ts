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

export const getBreakMode = (): BreakMode => {
  if (typeof window === 'undefined') {
    return 'none'
  }

  let rawMode: string | null = null
  try {
    rawMode = localStorage.getItem(BREAK_KEY)
  } catch {
    return 'none'
  }

  if (!rawMode) {
    return 'none'
  }
  if (!allowedModes.includes(rawMode as BreakMode)) {
    return 'none'
  }
  return rawMode as BreakMode
}

export const setBreakMode = (mode: BreakMode): void => {
  if (typeof window === 'undefined') {
    return
  }
  try {
    localStorage.setItem(BREAK_KEY, mode)
  } catch {
    return
  }
  window.dispatchEvent(
    new CustomEvent<BreakMode>(BREAK_MODE_EVENT, {
      detail: mode,
    }),
  )
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

