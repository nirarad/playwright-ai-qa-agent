import Link from 'next/link'

const HomePage = () => {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6">
      <h1
        className="mb-4 text-4xl font-bold text-slate-900"
        data-testid="landing-heading"
      >
        TaskFlow
      </h1>
      <p className="mb-8 text-slate-600">Simple task management, AI-tested.</p>
      <div className="flex gap-4">
        <Link
          href="/login"
          data-testid="login-link"
          className="rounded-md bg-blue-600 px-6 py-2 font-medium text-white"
        >
          Sign In
        </Link>
        <Link
          href="/register"
          data-testid="register-link"
          className="rounded-md border border-blue-600 px-6 py-2 font-medium text-blue-600"
        >
          Register
        </Link>
      </div>
    </main>
  )
}

export default HomePage

