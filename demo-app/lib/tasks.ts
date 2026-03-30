import { getBreakMode } from '@/lib/break-mode'
import { isQaFlagEnabled } from '@/lib/feature-flags'
import type { Task } from '@/lib/types'

const TASKS_KEY = 'demo_tasks'

const getAllTasks = (): Task[] => {
  const rawTasks = localStorage.getItem(TASKS_KEY)
  if (!rawTasks) {
    return []
  }

  try {
    return JSON.parse(rawTasks) as Task[]
  } catch {
    return []
  }
}

const writeAllTasks = (tasks: Task[]): void => {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks))
}

const delayIfNeeded = async (): Promise<void> => {
  const hasDelay =
    getBreakMode() === 'slow-network' || isQaFlagEnabled('env.slowNetwork')
  if (!hasDelay) {
    return
  }
  await new Promise((resolve) => {
    setTimeout(resolve, 3000)
  })
}

export const getTasks = (userId: string): Task[] => {
  return getAllTasks().filter((task) => task.userId === userId)
}

export const addTask = async (userId: string, title: string): Promise<Task> => {
  await delayIfNeeded()

  const forceLogicBug =
    getBreakMode() === 'logic-bug' || isQaFlagEnabled('bug.emptyTaskSaves')

  if (!forceLogicBug && title.trim().length === 0) {
    throw new Error('Task title cannot be empty')
  }

  const task: Task = {
    id: crypto.randomUUID(),
    title: forceLogicBug ? '' : title.trim(),
    completed: false,
    createdAt: new Date().toISOString(),
    userId,
  }

  writeAllTasks([...getAllTasks(), task])
  return task
}

export const toggleTask = async (taskId: string): Promise<void> => {
  await delayIfNeeded()
  const updatedTasks = getAllTasks().map((task) => {
    if (task.id !== taskId) {
      return task
    }
    return {
      ...task,
      completed: !task.completed,
    }
  })
  writeAllTasks(updatedTasks)
}

export const deleteTask = async (taskId: string): Promise<void> => {
  await delayIfNeeded()
  const updatedTasks = getAllTasks().filter((task) => task.id !== taskId)
  writeAllTasks(updatedTasks)
}

