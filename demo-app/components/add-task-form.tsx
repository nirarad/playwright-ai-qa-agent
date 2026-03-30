'use client'

import { FormEvent, useEffect, useState } from 'react'
import { getBreakMode, onBreakModeChange } from '@/lib/break-mode'

interface AddTaskFormProps {
  onAddTask: (title: string) => Promise<void> | void
  error?: string
}

export const AddTaskForm = ({ onAddTask, error }: AddTaskFormProps) => {
  const [title, setTitle] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasSelectorChange, setHasSelectorChange] = useState(() => getBreakMode() === 'selector-change')

  useEffect(() => {
    setHasSelectorChange(getBreakMode() === 'selector-change')

    const unsubscribe = onBreakModeChange((mode) => {
      setHasSelectorChange(mode === 'selector-change')
    })
    return () => {
      unsubscribe()
    }
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      await onAddTask(title)
      setTitle('')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Add a task..."
          data-testid={hasSelectorChange ? 'task-input-v2' : 'task-input'}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2"
        />
        <button
          type="submit"
          data-testid={hasSelectorChange ? 'add-task-button-v2' : 'add-task-button'}
          disabled={isSubmitting}
          className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          Add Task
        </button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  )
}

