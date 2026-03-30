'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h2 className="text-xl font-semibold text-slate-900">Something went wrong</h2>
      <p className="text-sm text-slate-600">{error.message}</p>
      <button
        onClick={() => reset()}
        className="rounded-md bg-blue-600 px-4 py-2 text-white"
      >
        Try again
      </button>
    </main>
  )
}

