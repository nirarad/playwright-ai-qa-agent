'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthForm } from '@/components/auth-form'
import { getSession, register } from '@/lib/auth'

const RegisterPage = () => {
  const router = useRouter()
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const activeSession = getSession()
    if (activeSession) {
      router.replace('/dashboard')
    }
  }, [router])

  const handleSubmit = async (
    email: string,
    password: string,
    displayName?: string,
  ) => {
    if (!displayName) {
      setErrorMessage('Display name is required')
      return
    }
    setErrorMessage('')
    try {
      register(email, password, displayName)
      router.push('/dashboard')
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
        return
      }
      setErrorMessage('Registration failed')
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-2xl font-semibold text-slate-900">Register</h1>
      <AuthForm mode="register" onSubmit={handleSubmit} error={errorMessage} />
    </main>
  )
}

export default RegisterPage

