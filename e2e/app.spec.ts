import { expect, test as base, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const fixture = (name: string) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name)

/**
 * Every test runs signed out with the network closed to anything but the app itself
 * (web fonts, Supabase and the like are aborted), and fails on any uncaught page error,
 * console error or request that tried to leave localhost.
 */
const test = base.extend<{ page: Page }>({
  page: async ({ page, baseURL }, use) => {
    const origin = new URL(baseURL!).origin
    const external: string[] = []
    const errors: string[] = []
    await page.route('**/*', route => {
      const url = route.request().url()
      if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue()
      external.push(url)
      return route.abort()
    })
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`) })
    await use(page)
    expect(errors, 'uncaught page errors or console errors').toEqual([])
    // The only outside requests allowed are the ones we just aborted: web fonts.
    expect(external.filter(u => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)), 'unexpected external requests').toEqual([])
  },
})

const openSample = async (page: Page) => {
  await page.goto('/app')
  await page.getByRole('button', { name: 'Try the sample' }).click()
  await expect(page.getByRole('heading', { name: /Northwind Cloud/ })).toBeVisible()
}

const newPack = async (page: Page, name: string) => {
  await page.goto('/app')
  await page.getByRole('button', { name: 'New close pack' }).click()
  await page.getByLabel('Company or reporting group').fill(name)
  await page.getByRole('button', { name: 'Create and import' }).click()
  await expect(page.getByRole('dialog', { name: 'Import data' })).toBeVisible()
}

const chooseFile = (page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) =>
  page.getByRole('dialog', { name: 'Import data' }).locator('input[type=file]').setInputFiles(file)

const importDialog = (page: Page) => page.getByRole('dialog', { name: 'Import data' })

test('opening the sample shows budget-vs-actual variances', async ({ page }) => {
  await openSample(page)
  await expect(page.getByRole('button', { name: 'vs Budget' })).toHaveAttribute('aria-pressed', 'true')
  // Headline numbers of the synthetic October close (deterministic, seeded data).
  const kpis = page.locator('.kpi')
  await expect(kpis.filter({ hasText: 'Revenue' })).toContainText('$682k')
  await expect(kpis.filter({ hasText: 'Net income' })).toContainText('+$45k')
  await expect(kpis.filter({ hasText: 'Flagged for commentary' })).toContainText('2')
  const table = page.getByRole('table', { name: 'Variance by account' })
  await expect(table.getByRole('columnheader', { name: 'Var $' })).toBeVisible()
  // The marketing overspend is flagged and shown against its budget.
  const row = table.locator('tr.acc-row', { hasText: '6100' })
  await expect(row).toHaveClass(/flagged/)
  await expect(row.locator('td').nth(0)).toHaveText(/^\$\d/)
  await expect(row.locator('td').nth(2)).toHaveText(/^\+\$\d/)
  await expect(row.locator('td').nth(2)).toHaveClass(/unfav-t/)
})

test('an edited commentary shows in the pack and survives a reload', async ({ page }) => {
  await openSample(page)
  await page.getByRole('link', { name: /^Commentary/ }).click()
  const note = page.getByRole('textbox', { name: /^Commentary for / }).first()
  await expect(note).toBeVisible()
  const text = 'E2E: marketing overspend agreed with the budget owner.'
  await note.fill(text)
  await note.blur()
  await expect(page.getByText(/Edited · carries into next month/).first()).toBeVisible()

  await page.getByRole('link', { name: 'Overview' }).click()
  await page.getByRole('link', { name: 'Board pack' }).click()
  await expect(page.getByRole('heading', { name: 'Commentary on material variances' })).toBeVisible()
  await expect(page.locator('.pack-notes')).toContainText(text)

  // Persistence: the edit lives in IndexedDB, so it is still there after a reload.
  await page.reload()
  await expect(page.locator('.pack-notes')).toContainText(text)
})

test('importing actuals and a budget produces a variance, and it persists', async ({ page }) => {
  await newPack(page, 'E2E Co')
  await chooseFile(page, fixture('actuals-2026-10.csv'))
  const dialog = importDialog(page)
  await expect(dialog.getByText('Generic layout')).toBeVisible()
  await expect(dialog.getByText('4 rows ready')).toBeVisible()
  await expect(dialog.getByText('0 errors')).toBeVisible()
  await expect(dialog.getByText('debits equal credits')).toBeVisible()
  await dialog.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText('Imported 4 rows from actuals-2026-10.csv.')).toBeVisible()

  await page.getByRole('button', { name: 'Import file' }).click()
  await chooseFile(page, fixture('budget-2026-10.csv'))
  await expect(dialog.getByText('Budget, one row per account and month')).toBeVisible()
  await dialog.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText('Imported 3 rows from budget-2026-10.csv.')).toBeVisible()
  await expect(page.getByRole('table').first()).toContainText('actuals-2026-10.csv')

  await page.getByRole('link', { name: 'Overview' }).click()
  const expectVariance = async () => {
    const kpis = page.locator('.kpi')
    await expect(kpis.filter({ hasText: 'Revenue' })).toContainText('$120k')
    await expect(kpis.filter({ hasText: 'Net income' })).toContainText('-$10k') // 120,000 - 50,000 - 80,000
    const row = page.locator('tr.acc-row', { hasText: '6100' })
    await expect(row).toHaveClass(/flagged/)
    await expect(row.locator('td').nth(0)).toHaveText('$80,000')
    await expect(row.locator('td').nth(1)).toHaveText('$40,000')
    await expect(row.locator('td').nth(2)).toHaveText('+$40,000')
    await expect(row.locator('td').nth(3)).toHaveText('+100%')
    await expect(row.locator('td').nth(2)).toHaveClass(/unfav-t/) // an expense over budget is unfavourable
    await page.getByRole('table', { name: 'Variance by account' }).getByRole('button', { name: 'Subscription revenue' }).click()
    const revenue = page.locator('tr.acc-row', { hasText: '4000' }).locator('td').nth(2)
    await expect(revenue).toHaveText('+$10,000')
    await expect(revenue).toHaveClass(/\bfav-t\b/) // revenue over budget is favourable
  }
  await expectVariance()

  // Persistence: the pack, its ledger and its budget are in IndexedDB.
  await page.reload()
  await expectVariance()
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'E2E Co' })).toBeVisible()
})

test.describe('files the importer cannot use', () => {
  type Upload = string | { name: string; mimeType: string; buffer: Buffer }
  const brokenXlsx = { name: 'broken.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 0xff)]) }

  /** After a refused or empty import, the app must still take a good file in the same dialog. */
  const thenImportGoodFile = async (page: Page, bad: string) => {
    const dialog = importDialog(page)
    if (await dialog.getByRole('button', { name: 'Choose another file' }).isVisible()) await dialog.getByRole('button', { name: 'Choose another file' }).click()
    await chooseFile(page, fixture('actuals-2026-10.csv'))
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page.getByText('Imported 4 rows from actuals-2026-10.csv.')).toBeVisible()
    const imports = page.getByRole('table').first()
    await expect(imports).toContainText('actuals-2026-10.csv')
    await expect(imports).not.toContainText(bad)
    await expect(page.getByText('Ledger checks')).toBeVisible()
  }

  const refused: { title: string; file: Upload; name: string; message: RegExp }[] = [
    { title: 'an empty file', file: fixture('empty.csv'), name: 'empty.csv', message: /The file is empty\./ },
    { title: 'a corrupt spreadsheet', file: brokenXlsx, name: 'broken.xlsx', message: /\S/ },
  ]
  for (const c of refused) {
    test(`${c.title} is refused with a message and the app stays usable`, async ({ page }) => {
      await newPack(page, 'Bad file Co')
      await chooseFile(page, c.file)
      const alert = importDialog(page).getByRole('alert')
      await expect(alert).toBeVisible()
      await expect(alert).toContainText(c.message)
      await expect(importDialog(page).getByRole('button', { name: /^Import/ })).toHaveCount(0)
      await thenImportGoodFile(page, c.name)
    })
  }

  const reported: { title: string; name: string; issue: RegExp; errors: string }[] = [
    { title: 'amounts that are not numbers', name: 'bad-amounts.csv', issue: /Line 2 Amount "not-a-number" is not a number/, errors: '1 error' },
    { title: 'a contact list instead of a ledger', name: 'contacts.csv', issue: /Line 2 No account on this row/, errors: '2 errors' },
  ]
  for (const c of reported) {
    test(`${c.title}: errors are listed line by line, nothing is imported, and the app stays usable`, async ({ page }) => {
      await newPack(page, 'Bad file Co')
      await chooseFile(page, fixture(c.name))
      const dialog = importDialog(page)
      await expect(dialog.getByText('0 rows ready')).toBeVisible()
      await expect(dialog.getByText(c.errors)).toBeVisible()
      await expect(dialog.locator('.issues')).toContainText(c.issue)
      await expect(dialog.getByRole('button', { name: /^Import/ })).toBeDisabled()
      await thenImportGoodFile(page, c.name)
    })
  }

  // Known gap, reported as https://github.com/AryanKansagara/variance-pack/issues/3: a file with no readable rows
  // shows no message at all. This asserts what must hold regardless: nothing can be imported and the app stays usable.
  test('a text note is not importable and the app stays usable', async ({ page }) => {
    await newPack(page, 'Bad file Co')
    await chooseFile(page, fixture('not-a-ledger.csv'))
    const dialog = importDialog(page)
    await expect(dialog.getByText('0 rows ready')).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^Import/ })).toBeDisabled()
    await thenImportGoodFile(page, 'not-a-ledger.csv')
  })
})
