'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import type { User } from '@/lib/types'

interface SessionGuardProps {
  children: (user: User) => ReactNode
}

export const SessionGuard = ({ children }: SessionGuardProps) => {
  const router = useRouter()
  const [sessionUser, setSessionUser] = useState<User | null>(null)
  const [isChecking, setIsChecking] = useState(true)

  useEffect(() => {
    const activeSession = getSession()
    if (!activeSession) {
      router.replace('/login')
      return
    }
    setSessionUser(activeSession)
    setIsChecking(false)
  }, [router])

  if (isChecking || !sessionUser) {
    return <p className="p-8 text-sm text-slate-500">Checking session...</p>
  }

  return <>{children(sessionUser)}</>
}

