import { getBreakMode } from '@/lib/break-mode'
import { isQaFlagEnabled } from '@/lib/feature-flags'
import type { User } from '@/lib/types'

const USERS_KEY = 'demo_users'
const SESSION_KEY = 'demo_session'

const getUsers = (): User[] => {
  const rawUsers = localStorage.getItem(USERS_KEY)
  if (!rawUsers) {
    return []
  }

  try {
    return JSON.parse(rawUsers) as User[]
  } catch {
    return []
  }
}

const writeUsers = (users: User[]): void => {
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

export const register = (
  email: string,
  password: string,
  displayName: string,
): User => {
  const existingUser = getUsers().find((user) => user.email === email)
  if (existingUser) {
    throw new Error('Email already registered')
  }

  const newUser: User = {
    id: crypto.randomUUID(),
    email,
    password,
    displayName,
  }
  writeUsers([...getUsers(), newUser])
  localStorage.setItem(SESSION_KEY, JSON.stringify(newUser))
  return newUser
}

export const login = (email: string, password: string): User => {
  const isAuthBroken =
    getBreakMode() === 'auth-break' || isQaFlagEnabled('bug.authBreak')

  if (isAuthBroken) {
    throw new Error('Invalid credentials')
  }

  const existingUser = getUsers().find(
    (user) => user.email === email && user.password === password,
  )
  if (!existingUser) {
    throw new Error('Invalid credentials')
  }

  localStorage.setItem(SESSION_KEY, JSON.stringify(existingUser))
  return existingUser
}

export const logout = (): void => {
  localStorage.removeItem(SESSION_KEY)
}

export const getSession = (): User | null => {
  const rawSession = localStorage.getItem(SESSION_KEY)
  if (!rawSession) {
    return null
  }
  try {
    return JSON.parse(rawSession) as User
  } catch {
    return null
  }
}

export const updateDisplayName = (displayName: string): User => {
  const session = getSession()
  if (!session) {
    throw new Error('No active session')
  }

  const users = getUsers()
  const updatedUsers = users.map((user) => {
    if (user.id !== session.id) {
      return user
    }
    return {
      ...user,
      displayName,
    }
  })

  writeUsers(updatedUsers)
  const updatedSession = {
    ...session,
    displayName,
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(updatedSession))
  return updatedSession
}

