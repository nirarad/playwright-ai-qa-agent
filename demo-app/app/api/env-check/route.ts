import { NextResponse } from 'next/server'

export async function GET() {
  if (!process.env.QA_REQUIRED_ENV) {
    return NextResponse.json(
      {
        ok: false,
        code: 'ENV_MISCONFIGURED',
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
  })
}

