import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { BreakModeBootstrap } from '@/components/break-mode-bootstrap'
import { DevPanel } from '@/components/dev-panel'

export const metadata: Metadata = {
  title: 'TaskFlow Demo App',
  description: 'Demo target for Playwright AI QA pipeline',
}

const RootLayout = ({ children }: { children: ReactNode }) => {
  return (
    <html lang="en">
      <body>
        <BreakModeBootstrap />
        {children}
        <DevPanel />
      </body>
    </html>
  )
}

export default RootLayout

