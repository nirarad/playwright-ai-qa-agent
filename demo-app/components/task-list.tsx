'use client'

import type { Task } from '@/lib/types'
import { TaskItem } from '@/components/task-item'

interface TaskListProps {
  tasks: Task[]
  onToggle: (taskId: string) => Promise<void> | void
  onDelete: (taskId: string) => Promise<void> | void
}

export const TaskList = ({ tasks, onToggle, onDelete }: TaskListProps) => {
  if (tasks.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
        No tasks yet.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <TaskItem key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} />
      ))}
    </div>
  )
}

