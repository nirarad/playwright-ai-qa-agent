'use client'

import type { Task } from '@/lib/types'

interface TaskItemProps {
  task: Task
  onToggle: (taskId: string) => Promise<void> | void
  onDelete: (taskId: string) => Promise<void> | void
}

export const TaskItem = ({ task, onToggle, onDelete }: TaskItemProps) => {
  return (
    <div
      data-testid={`task-item-${task.id}`}
      className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3"
    >
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={task.completed}
          data-testid={`task-checkbox-${task.id}`}
          onChange={() => onToggle(task.id)}
        />
        <span
          data-testid={`task-title-${task.id}`}
          className={task.completed ? 'text-slate-400 line-through' : 'text-slate-800'}
        >
          {task.title.length > 0 ? task.title : '(empty title)'}
        </span>
      </div>
      <button
        data-testid={`task-delete-${task.id}`}
        onClick={() => onDelete(task.id)}
        className="rounded-md border border-red-200 px-3 py-1 text-sm text-red-600"
      >
        Delete
      </button>
    </div>
  )
}

