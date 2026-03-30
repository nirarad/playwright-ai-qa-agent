import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { DevPanel } from '@/components/dev-panel'

export const metadata: Metadata = {
  title: 'TaskFlow Demo App',
  description: 'Demo target for Playwright AI QA pipeline',
}

const RootLayout = ({ children }: { children: ReactNode }) => {
  return (
    <html lang="en">
      <body>
        {children}
        <DevPanel />
      </body>
    </html>
  )
}

export default RootLayout

