'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { SessionGuard } from '@/components/session-guard'
import { updateDisplayName } from '@/lib/auth'
import { getBreakMode, onBreakModeChange } from '@/lib/break-mode'
import type { User } from '@/lib/types'

const ProfileContent = ({ user }: { user: User }) => {
  const [displayName, setDisplayName] = useState(user.displayName)
  const [savedName, setSavedName] = useState(user.displayName)
  const [errorMessage, setErrorMessage] = useState('')
  const [hasSelectorChange, setHasSelectorChange] = useState(() => getBreakMode() === 'selector-change')

  useEffect(() => {
    setHasSelectorChange(getBreakMode() === 'selector-change')

    const unsubscribe = onBreakModeChange((mode) => {
      setHasSelectorChange(mode === 'selector-change')
    })
    return () => {
      unsubscribe()
    }
  }, [])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage('')
    try {
      const updatedUser = updateDisplayName(displayName.trim())
      setSavedName(updatedUser.displayName)
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
        return
      }
      setErrorMessage('Could not update profile')
    }
  }

  return (
    <main className="mx-auto max-w-lg space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Profile</h1>
        <Link
          href="/dashboard"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          Back
        </Link>
      </header>

      <div className="rounded-md border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">Current display name</p>
        <p
          data-testid="profile-displayname"
          className="mt-1 text-lg font-medium text-slate-900"
        >
          {savedName}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-md border border-slate-200 bg-white p-4"
      >
        <label className="block text-sm font-medium text-slate-700">
          Display Name
        </label>
        <input
          data-testid={hasSelectorChange ? 'displayname-edit-input-v2' : 'displayname-edit-input'}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2"
          required
        />
        <button
          data-testid="save-profile-button"
          type="submit"
          className="rounded-md bg-blue-600 px-4 py-2 text-white"
        >
          Save
        </button>
        {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
      </form>
    </main>
  )
}

const ProfilePage = () => {
  return <SessionGuard>{(user) => <ProfileContent user={user} />}</SessionGuard>
}

export default ProfilePage

