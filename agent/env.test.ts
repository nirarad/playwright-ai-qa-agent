import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { readLastValueForKeyFromFile, stripEnvQuotes } from './env.js'

describe('stripEnvQuotes', () => {
	it('removes balanced single quotes', () => {
		assert.equal(stripEnvQuotes("'ghp_abc'"), 'ghp_abc')
	})

	it('removes leading stray single quote (unclosed in .env)', () => {
		assert.equal(stripEnvQuotes("'ghp_abc"), 'ghp_abc')
	})

	it('removes balanced double quotes', () => {
		assert.equal(stripEnvQuotes('"ghp_abc"'), 'ghp_abc')
	})

	it('leaves token without edge quotes unchanged', () => {
		assert.equal(stripEnvQuotes('ghp_abc'), 'ghp_abc')
	})
})

describe('readLastValueForKeyFromFile', () => {
	it('returns the last assignment for a key', () => {
		const dir = mkdtempSync(join(tmpdir(), 'env-test-'))
		try {
			const p = join(dir, '.env')
			writeFileSync(
				p,
				'GITHUB_TOKEN=first\nGITHUB_TOKEN=second\nOTHER=x\n',
				'utf-8',
			)
			assert.equal(readLastValueForKeyFromFile(p, 'GITHUB_TOKEN'), 'second')
			assert.equal(readLastValueForKeyFromFile(p, 'OTHER'), 'x')
			assert.equal(readLastValueForKeyFromFile(p, 'MISSING'), null)
		} finally {
			rmSync(dir, { recursive: true })
		}
	})

	it('ignores UTF-8 BOM at file start', () => {
		const dir = mkdtempSync(join(tmpdir(), 'env-test-'))
		try {
			const p = join(dir, '.env')
			writeFileSync(p, `\uFEFFGITHUB_TOKEN=bom_ok\n`, 'utf-8')
			assert.equal(readLastValueForKeyFromFile(p, 'GITHUB_TOKEN'), 'bom_ok')
		} finally {
			rmSync(dir, { recursive: true })
		}
	})
})
