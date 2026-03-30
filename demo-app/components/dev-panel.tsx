'use client'

import { useEffect, useMemo, useState } from 'react'
import { getBreakMode, onBreakModeChange, setBreakMode } from '@/lib/break-mode'
import type { BreakMode } from '@/lib/types'

const modes: { value: BreakMode; label: string; description: string }[] = [
  { value: 'none', label: 'Normal', description: 'All tests should pass' },
  {
    value: 'selector-change',
    label: 'Break Selectors',
    description: 'Renames data-testid values',
  },
  {
    value: 'logic-bug',
    label: 'Logic Bug',
    description: 'Allows empty tasks',
  },
  {
    value: 'slow-network',
    label: 'Slow Network',
    description: 'Adds 3s delay to task actions',
  },
  {
    value: 'auth-break',
    label: 'Auth Break',
    description: 'Login always fails',
  },
]

export const DevPanel = () => {
  const [currentMode, setCurrentMode] = useState<BreakMode>('none')

  const showPanel = useMemo(() => {
    if (process.env.NODE_ENV !== 'production') {
      return true
    }
    return process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
  }, [])

  useEffect(() => {
    setCurrentMode(getBreakMode())
    const unsubscribe = onBreakModeChange((mode) => {
      setCurrentMode(mode)
    })
    return () => {
      unsubscribe()
    }
  }, [])

  const handleModeChange = (mode: BreakMode) => {
    setBreakMode(mode)
  }

  if (!showPanel) {
    return null
  }

  return (
    <div
      data-testid="dev-panel"
      className="fixed bottom-4 right-4 z-[9999] w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border border-slate-700 bg-slate-950/95 p-4 text-sm text-slate-100 shadow-xl backdrop-blur"
    >
      <p className="mb-2 font-semibold text-amber-400">QA Dev Panel</p>
      {modes.map((mode) => (
        <label key={mode.value} className="mb-1 block cursor-pointer select-none">
          <input
            type="radio"
            name="break-mode"
            value={mode.value}
            checked={currentMode === mode.value}
            onChange={() => handleModeChange(mode.value)}
            className="mr-2"
          />
          <strong>{mode.label}</strong>
          <span className="ml-2 text-slate-400">{mode.description}</span>
        </label>
      ))}
    </div>
  )
}

