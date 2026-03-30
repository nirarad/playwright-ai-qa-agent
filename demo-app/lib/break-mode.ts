import type { BreakMode } from '@/lib/types'

const BREAK_KEY = 'demo_break_mode'

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

  const rawMode = localStorage.getItem(BREAK_KEY)
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
  localStorage.setItem(BREAK_KEY, mode)
}

