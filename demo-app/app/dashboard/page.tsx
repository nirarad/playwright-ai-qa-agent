'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AddTaskForm } from '@/components/add-task-form'
import { SessionGuard } from '@/components/session-guard'
import { TaskList } from '@/components/task-list'
import { logout } from '@/lib/auth'
import { addTask, deleteTask, getTasks, toggleTask } from '@/lib/tasks'
import type { Task, User } from '@/lib/types'

const DashboardContent = ({ user }: { user: User }) => {
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskError, setTaskError] = useState('')

  const refreshTasks = useCallback(() => {
    setTasks(getTasks(user.id))
  }, [user.id])

  useEffect(() => {
    refreshTasks()
  }, [refreshTasks])

  const handleAddTask = async (title: string) => {
    setTaskError('')
    try {
      await addTask(user.id, title)
      refreshTasks()
    } catch (error) {
      if (error instanceof Error) {
        setTaskError(error.message)
        return
      }
      setTaskError('Could not add task')
    }
  }

  const handleToggleTask = async (taskId: string) => {
    await toggleTask(taskId)
    refreshTasks()
  }

  const handleDeleteTask = async (taskId: string) => {
    await deleteTask(taskId)
    refreshTasks()
  }

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-600">Welcome, {user.displayName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/profile"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            Profile
          </Link>
          <button
            onClick={handleLogout}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            Logout
          </button>
        </div>
      </header>

      <AddTaskForm onAddTask={handleAddTask} error={taskError} />
      <p className="text-sm text-slate-500">Total tasks: {tasks.length}</p>
      <TaskList tasks={tasks} onToggle={handleToggleTask} onDelete={handleDeleteTask} />
    </main>
  )
}

const DashboardPage = () => {
  return <SessionGuard>{(user) => <DashboardContent user={user} />}</SessionGuard>
}

export default DashboardPage

