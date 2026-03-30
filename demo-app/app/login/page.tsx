'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthForm } from '@/components/auth-form'
import { getSession, login } from '@/lib/auth'

const LoginPage = () => {
  const router = useRouter()
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const activeSession = getSession()
    if (activeSession) {
      router.replace('/dashboard')
    }
  }, [router])

  const handleSubmit = async (email: string, password: string) => {
    setErrorMessage('')
    try {
      login(email, password)
      router.push('/dashboard')
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
        return
      }
      setErrorMessage('Login failed')
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-2xl font-semibold text-slate-900">Sign In</h1>
      <AuthForm mode="login" onSubmit={handleSubmit} error={errorMessage} />
    </main>
  )
}

export default LoginPage

