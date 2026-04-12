import { defineConfig, devices } from '@playwright/test'

function parseSlowMoMs(): number | undefined {
  const raw = process.env.PLAYWRIGHT_SLOW_MO
  if (raw === undefined || raw === '') return undefined
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return undefined
  return n
}

const slowMoMs = parseSlowMoMs()

export default defineConfig({
  testDir: './showcase',
  outputDir: '../test-results/artifacts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: '../test-results/results.json' }],
    ['html', { outputFolder: '../test-results/html-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    ...(slowMoMs !== undefined
      ? { launchOptions: { slowMo: slowMoMs } }
      : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})

