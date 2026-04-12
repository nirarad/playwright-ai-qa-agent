import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { extractFailures } from './context.js'
import type { AgentConfig } from './types.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const resultsPath = join(repoRoot, 'test-results', 'results.json')

describe('extractFailures test source resolution', () => {
  it('joins Playwright rootDir with spec file so testSource is readable (addTask in source)', () => {
    if (!existsSync(resultsPath)) {
      return
    }

    const minimalConfig = {
      paths: { resultsJson: resultsPath },
    } as AgentConfig

    const failures = extractFailures(minimalConfig)
    const adding = failures.find((f) => f.testName === 'adding task shows the provided title')
    assert.ok(adding, 'expected adding-task failure from showcase results')
    assert.ok(
      adding!.testSource.includes('addTask'),
      'testSource should load from tests/showcase via config.rootDir, not be empty',
    )
  })
})
