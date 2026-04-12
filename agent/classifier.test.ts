import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  buildClassificationPrompt,
  classifyFailure,
  narrowClassificationContext,
  shouldOverrideBrokenLocatorToRealBug,
} from './classifier.js'
import type { FailureContext } from './types.js'

const withMockProvider = async <T>(fn: () => Promise<T>): Promise<T> => {
  const prev = process.env.AI_PROVIDER
  process.env.AI_PROVIDER = 'mock'
  try {
    return await fn()
  } finally {
    if (prev === undefined) {
      delete process.env.AI_PROVIDER
    } else {
      process.env.AI_PROVIDER = prev
    }
  }
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const minimalCtx = (overrides: Partial<FailureContext> = {}): FailureContext => ({
  testName: 'adding task shows the provided title',
  testFile: 'tasks.spec.ts',
  testSource: `await dashboardPage.addTask('Buy groceries')\nawait expect(page.getByText('Buy groceries')).toBeVisible()`,
  error: `expect(locator).toBeVisible() failed\nLocator: getByText('Buy groceries')\nExpected: visible`,
  errorStack: 'at tasks.spec.ts:8',
  playwrightErrorMessages: "waiting for getByText('Buy groceries')",
  runUrl: '',
  branch: '',
  commit: '',
  ...overrides,
})

describe('buildClassificationPrompt', () => {
  it('requires artifact-only reasoning and disambiguates REAL_BUG vs BROKEN_LOCATOR', () => {
    const prompt = buildClassificationPrompt(minimalCtx(), false)
    assert.match(prompt, /Do not assume hidden test harness flags/i)
    assert.match(prompt, /Expected vs Received/i)
    assert.match(prompt, /wrong or missing user-visible outcome/)
    assert.match(prompt, /current DOM contract/)
    assert.ok(!prompt.includes('QA_MODE'))
  })

  it('prepends locator rule hint when locatorRuleExplanationOnly', () => {
    const prompt = buildClassificationPrompt(minimalCtx(), true)
    assert.match(prompt, /Deterministic rule.*BROKEN_LOCATOR/s)
  })
})

describe('narrowClassificationContext', () => {
  it('truncates long optional fields for every provider', () => {
    const long = 'x'.repeat(5000)
    const ctx = minimalCtx({
      domSnapshot: long,
      testSource: long,
      errorContext: long,
      playwrightErrorMessages: long,
    })
    const out = narrowClassificationContext(ctx, {
      maxDomChars: 100,
      maxErrorContextChars: 100,
      maxTestSourceChars: 100,
    })
    assert.ok(out.domSnapshot?.includes('classification context limit'))
    assert.ok(out.errorContext?.includes('classification context limit'))
    assert.ok(out.testSource.includes('classification context limit'))
    assert.ok(out.playwrightErrorMessages?.includes('classification context limit'))
    assert.equal(out.error, ctx.error)
    assert.equal(out.errorStack, ctx.errorStack)
  })
})

describe('shouldOverrideBrokenLocatorToRealBug', () => {
  it('is true when the test calls addTask with a string then getByText that string fails', () => {
    assert.equal(
      shouldOverrideBrokenLocatorToRealBug(
        minimalCtx({
          error: `Error: expect(locator).toBeVisible() failed\nLocator: getByText('Buy groceries')\nError: element(s) not found`,
        }),
      ),
      true,
    )
  })

  it('is true for delete-task flow with two addTask calls and getByText miss', () => {
    assert.equal(
      shouldOverrideBrokenLocatorToRealBug({
        testName: 'delete removes only targeted task',
        testFile: 'tasks.spec.ts',
        testSource: `await dashboardPage.addTask('Keep this task')\nawait dashboardPage.addTask('Delete this task')\nawait expect(page.getByText('Keep this task')).toBeVisible()`,
        error: `expect(locator).toBeVisible() failed\nLocator: getByText('Keep this task')\nError: element(s) not found`,
        errorStack: '',
        playwrightErrorMessages: "waiting for getByText('Keep this task')",
        runUrl: '',
        branch: '',
        commit: '',
      }),
      true,
    )
  })

  it('is false when getByText target was not passed via addTask/fill/type in the test source', () => {
    assert.equal(
      shouldOverrideBrokenLocatorToRealBug(
        minimalCtx({
          testSource: `await page.getByRole('button').click()\nawait expect(page.getByText('Buy groceries')).toBeVisible()`,
        }),
      ),
      false,
    )
  })

  it('is false when failure is getByTestId / structural locator, not getByText visibility', () => {
    assert.equal(
      shouldOverrideBrokenLocatorToRealBug(
        minimalCtx({
          testSource: `await page.getByTestId('task-list').click()`,
          error: `waiting for getByTestId('task-list')`,
          playwrightErrorMessages: 'resolved to 0 elements',
        }),
      ),
      false,
    )
  })
})

describe('classifyFailure: BROKEN_LOCATOR → REAL_BUG override (mock LLM)', () => {
  it('overrides mock BROKEN_LOCATOR when addTask literal matches getByText miss (tasks showcase)', async () => {
    await withMockProvider(async () => {
      const result = await classifyFailure(
        minimalCtx({
          error: `Error: expect(locator).toBeVisible() failed\n\nLocator: getByText('Buy groceries')\nExpected: visible\nError: element(s) not found`,
        }),
      )
      assert.equal(result.category, 'REAL_BUG')
      assert.equal(result.suggestedFix, null)
      assert.match(
        result.reason,
        /Test supplied this text via an action then asserted the same visible string/,
      )
    })
  })

  it('overrides mock BROKEN_LOCATOR for delete-task getByText miss after addTask', async () => {
    await withMockProvider(async () => {
      const result = await classifyFailure({
        testName: 'delete removes only targeted task',
        testFile: 'tasks.spec.ts',
        testSource: `await dashboardPage.addTask('Keep this task')\nawait dashboardPage.addTask('Delete this task')\nawait expect(page.getByText('Keep this task')).toBeVisible()`,
        error: `expect(locator).toBeVisible() failed\nLocator: getByText('Keep this task')\nError: element(s) not found`,
        errorStack: 'at tasks.spec.ts:25',
        playwrightErrorMessages: "waiting for getByText('Keep this task')",
        runUrl: '',
        branch: '',
        commit: '',
      })
      assert.equal(result.category, 'REAL_BUG')
      assert.equal(result.suggestedFix, null)
    })
  })

  it('does not override when mock classifies getByTestId-only failure as BROKEN_LOCATOR', async () => {
    await withMockProvider(async () => {
      const result = await classifyFailure(
        minimalCtx({
          testName: 'clicks task row',
          testSource: `await page.getByTestId('missing-row').click()`,
          error: `waiting for getByTestId('missing-row')\nresolved to 0 elements`,
          playwrightErrorMessages: 'locator.click: Target closed',
        }),
      )
      assert.equal(result.category, 'BROKEN_LOCATOR')
    })
  })

  it('mock classifies Expected/Received (empty input) as REAL_BUG without needing override', async () => {
    await withMockProvider(async () => {
      const result = await classifyFailure({
        testName: 'empty input does not create a task',
        testFile: 'tasks.spec.ts',
        testSource: `await expect(dashboardPage.taskItems).toHaveCount(0, { timeout: 1500 })`,
        error: `expect(locator).toHaveCount() failed\n\nExpected: 0\nReceived: 1`,
        errorStack: 'at tasks.spec.ts:15',
        playwrightErrorMessages: 'locator resolved to 1 element',
        runUrl: '',
        branch: '',
        commit: '',
      })
      assert.equal(result.category, 'REAL_BUG')
    })
  })
})

describe('fixture alignment (tasks showcase)', () => {
  it('when repo test-results/results.json exists, it lists the tasks adding-task spec', () => {
    const resultsPath = join(repoRoot, 'test-results', 'results.json')
    if (!existsSync(resultsPath)) {
      return
    }
    const raw = readFileSync(resultsPath, 'utf-8')
    const json = JSON.parse(raw) as { suites?: { file?: string }[] }
    const tasksSuite = (json.suites ?? []).find((s) => s.file === 'tasks.spec.ts')
    assert.ok(tasksSuite, 'expected tasks.spec suite in test-results/results.json')
  })

  it('prompt embeds Playwright error and test source for getByText miss after addTask', () => {
    const prompt = buildClassificationPrompt(
      minimalCtx({
        error:
          "Error: expect(locator).toBeVisible() failed\n\nLocator: getByText('Buy groceries')\nExpected: visible\nError: element(s) not found",
      }),
      false,
    )
    assert.match(prompt, /Buy groceries/)
    assert.match(prompt, /Test source:/)
    assert.match(prompt, /addTask\('Buy groceries'\)/)
  })
})
