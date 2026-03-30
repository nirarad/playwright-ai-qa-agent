import { test as base, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const QA_MODE = process.env.QA_MODE ?? 'none'

export interface Fixtures {
  seededPage: Page
  loggedInPage: Page
}

export const test = base.extend<Fixtures>({
  seededPage: async ({ page }, use) => {
    await page.goto(`${BASE_URL}/?qaMode=${QA_MODE}`)
    await seedBaseState(page)
    await use(page)
  },

  loggedInPage: async ({ page }, use) => {
    await page.goto(`${BASE_URL}/?qaMode=${QA_MODE}`)
    await seedBaseState(page)
    await page.evaluate(() => {
      const users = JSON.parse(localStorage.getItem('demo_users') ?? '[]')
      const user = users[0]
      if (!user) {
        throw new Error('Seed user is missing')
      }
      localStorage.setItem('demo_session', JSON.stringify(user))
    })
    await page.goto(`${BASE_URL}/dashboard`)
    await use(page)
  },
})

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) {
    return
  }

  try {
    const html = await page.content()
    const domPath = testInfo.outputPath('dom.html')
    await mkdir(dirname(domPath), { recursive: true })
    await writeFile(domPath, html, 'utf-8')
    await testInfo.attach('dom-snapshot', {
      path: domPath,
      contentType: 'text/html',
    })
  } catch {
    // Ignore capture errors so failure signal stays focused on the root test error.
  }
})

const seedBaseState = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    localStorage.setItem(
      'demo_users',
      JSON.stringify([
        {
          id: 'user-001',
          email: 'test@example.com',
          password: 'password123',
          displayName: 'Test User',
        },
      ]),
    )
    localStorage.setItem('demo_tasks', JSON.stringify([]))
    localStorage.removeItem('demo_session')
  })
}

export { expect } from '@playwright/test'

