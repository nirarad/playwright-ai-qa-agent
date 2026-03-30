import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({
    demo_users: JSON.stringify([
      {
        id: 'user-001',
        email: 'test@example.com',
        password: 'password123',
        displayName: 'Test User',
      },
    ]),
    demo_tasks: JSON.stringify([]),
    demo_break_mode: 'none',
  })
}

