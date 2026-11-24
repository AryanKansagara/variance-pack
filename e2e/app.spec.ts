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

test.describe('Xero year-to-date trial balances', () => {
  const importFile = async (page: Page, name: string, opts: { fiscalYearStart?: string } = {}) => {
    await page.getByRole('button', { name: 'Import file' }).click()
    const dialog = importDialog(page)
    await chooseFile(page, fixture(name))
    await expect(dialog.getByText('rows ready')).toBeVisible()
    if (opts.fiscalYearStart) await dialog.getByLabel('Fiscal year starts in').selectOption(opts.fiscalYearStart)
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page.getByText(`Imported`).filter({ hasText: name })).toBeVisible()
  }
  const febRow = (page: Page, account: string) => page.locator('tr.acc-row', { hasText: account })
  const open = async (page: Page, line: string) => page.getByRole('table', { name: 'Variance by account' }).getByRole('button', { name: line }).click()

  test('two successive imports give February as a month, not the year so far', async ({ page }) => {
    await newPack(page, 'Harbor Row Studio')
    const dialog = importDialog(page)
    await chooseFile(page, fixture('xero-tb-ytd-2026-01.csv'))
    await expect(dialog.getByText('Xero: Trial Balance')).toBeVisible()
    // The fiscal year start is asked for, never guessed: nothing can be imported until it is chosen.
    await expect(dialog.getByText(/Choose the month your fiscal year starts in/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
    await dialog.getByLabel('Fiscal year starts in').selectOption('1')
    await expect(dialog.getByText(/January 2026 is the first month of the fiscal year/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page.getByText('Imported 6 rows from xero-tb-ytd-2026-01.csv.')).toBeVisible()

    await page.getByRole('button', { name: 'Import file' }).click()
    await chooseFile(page, fixture('xero-tb-ytd-2026-02.csv'))
    await expect(dialog.getByText(/February 2026 = year to date as at February 2026 minus year to date as at January 2026\. New in this file: 485\./)).toBeVisible()
    await expect(dialog.getByLabel('Fiscal year starts in')).toHaveValue('1') // remembered
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page.getByText('Imported 8 rows from xero-tb-ytd-2026-02.csv.')).toBeVisible()
    await importFile(page, 'budget-2026-01-02.csv')

    // The Data tab says how each month was made, and the year-to-date files balance.
    const card = page.locator('.card', { hasText: 'Year-to-date trial balances' })
    await expect(card.locator('tr[data-state=first]')).toContainText('first month of the fiscal year')
    await expect(card.locator('tr[data-state=derived]')).toContainText('year to date as at February 2026 minus year to date as at January 2026')
    await expect(card.getByText('debits equal credits')).toHaveCount(2)
    await expect(page.getByText(/out of balance/)).toHaveCount(0)

    await page.getByRole('link', { name: 'Overview' }).click()
    const expectFebruary = async () => {
      await expect(page.getByLabel('Period')).toHaveValue('2026-02')
      const kpis = page.locator('.kpi')
      await expect(kpis.filter({ hasText: 'Revenue' })).toContainText('$45k') // February alone; the year so far is $85k
      await expect(kpis.filter({ hasText: 'Net income' })).toContainText('-$7.2k')
      await open(page, 'Product revenue')
      await expect(febRow(page, '200').locator('td').nth(0)).toHaveText('$45,000')
      await expect(febRow(page, '200').locator('td').nth(2)).toHaveText('+$1,000')
      await expect(febRow(page, '400').locator('td').nth(0)).toHaveText('$17,000')
      await expect(febRow(page, '400').locator('td').nth(2)).toHaveText('+$12,000')
      await expect(febRow(page, '400')).toHaveClass(/flagged/)
    }
    await expectFebruary()

    // Derived months and their year-to-date source persist.
    await page.reload()
    await expectFebruary()

    // January is its own year to date.
    await page.getByLabel('Period').selectOption('2026-01') // the line stays expanded from February
    await expect(febRow(page, '200').locator('td').nth(0)).toHaveText('$40,000')
  })

  test('a missing prior month holds the month back with a message, and importing it later fills it in', async ({ page }) => {
    await newPack(page, 'Harbor Row Studio')
    const dialog = importDialog(page)
    await chooseFile(page, fixture('xero-tb-ytd-2026-02.csv'))
    await dialog.getByLabel('Fiscal year starts in').selectOption('1')
    await expect(dialog.getByText(/February 2026 is held back: the January 2026 year-to-date trial balance is missing/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page.getByText(/February 2026 not shown yet: the previous month's year-to-date file is missing\./)).toBeVisible()

    // No year-to-date number is shown as a month: the pack has no months at all yet.
    await page.getByRole('link', { name: 'Overview' }).click()
    await expect(page.getByRole('heading', { name: 'Import a ledger to start the close' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'February 2026 is held back: the January 2026 year-to-date trial balance is missing' })).toBeVisible()
    await page.getByRole('link', { name: 'Data & mapping' }).click()
    await expect(page.locator('tr[data-state=blocked]')).toContainText('February 2026 is held back')

    // Out of order: January arrives second, and both months appear.
    await importFile(page, 'xero-tb-ytd-2026-01.csv')
    await importFile(page, 'budget-2026-01-02.csv')
    await expect(page.locator('tr[data-state=blocked]')).toHaveCount(0)
    await page.getByRole('link', { name: 'Overview' }).click()
    await expect(page.getByLabel('Period')).toHaveValue('2026-02')
    await open(page, 'Product revenue')
    await expect(febRow(page, '200').locator('td').nth(0)).toHaveText('$45,000')
  })

  test('changing the fiscal year start recomputes from the kept year-to-date files', async ({ page }) => {
    await newPack(page, 'Harbor Row Studio')
    await chooseFile(page, fixture('xero-tb-ytd-2026-01.csv'))
    await importDialog(page).getByLabel('Fiscal year starts in').selectOption('1')
    await importDialog(page).getByRole('button', { name: 'Import', exact: true }).click()
    await importFile(page, 'xero-tb-ytd-2026-02.csv')
    const card = page.locator('.card', { hasText: 'Year-to-date trial balances' })
    await expect(card.locator('tr[data-state=derived]')).toHaveCount(1)
    // With a February start, January needs December and February is a first month.
    await card.getByLabel('Fiscal year starts in').selectOption('2')
    await expect(card.locator('tr[data-state=blocked]')).toContainText('January 2026 is held back: the December 2025 year-to-date trial balance is missing')
    await expect(card.locator('tr[data-state=first]')).toContainText('February 2026 is the first month')
    await card.getByLabel('Fiscal year starts in').selectOption('1')
    await expect(card.locator('tr[data-state=derived]')).toHaveCount(1)
  })
})
