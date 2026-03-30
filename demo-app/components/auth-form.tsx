'use client'

import { FormEvent, useState } from 'react'

interface AuthFormProps {
  mode: 'login' | 'register'
  onSubmit: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<void> | void
  error?: string
}

export const AuthForm = ({ mode, onSubmit, error }: AuthFormProps) => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      await onSubmit(email, password, displayName)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          data-testid="email-input"
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          required
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          data-testid="password-input"
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          required
        />
      </div>

      {mode === 'register' ? (
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Display Name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            data-testid="displayname-input"
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            required
          />
        </div>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        data-testid="submit-button"
        className="w-full rounded-md bg-blue-600 px-3 py-2 font-medium text-white disabled:opacity-60"
      >
        {isSubmitting ? 'Submitting...' : mode === 'login' ? 'Sign In' : 'Register'}
      </button>

      {error ? (
        <p data-testid="error-message" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </form>
  )
}

