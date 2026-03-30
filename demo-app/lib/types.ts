export interface User {
  id: string
  email: string
  password: string
  displayName: string
}

export interface Task {
  id: string
  title: string
  completed: boolean
  createdAt: string
  userId: string
}

export type BreakMode =
  | 'none'
  | 'selector-change'
  | 'logic-bug'
  | 'slow-network'
  | 'auth-break'

