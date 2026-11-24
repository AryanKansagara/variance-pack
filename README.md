# Variance Pack

Month-end budget-vs-actual and flux analysis that ends in a reviewed commentary pack.

FP&A analysts and controllers rebuild the same variance deck in Excel every month: pull the trial balance, line it up against budget, dig through GL detail to find the vendor behind each big swing, decide whether it is timing or a real overspend, then write it all up. Variance Pack does the mechanical part and leaves the judgement to you.

## Features

- **Import** trial balance or GL detail (CSV/XLSX) from QuickBooks Online, Xero, NetSuite, Sage Intacct or any layout, plus a budget (long or one column per month) and an optional chart-of-accounts mapping. Format detection, column mapping, a line-numbered validation report, debit/credit balance checks and TB-to-GL tie-out.
- **Engine** (tested): P&L hierarchy roll-ups, budget / month-over-month / year-over-year variances with favourable and unfavourable sign handling, dual dollar-and-percent materiality, vendor and department driver decomposition (new, one-off, accrual), price/volume split, timing detection, multi-entity consolidation with editable FX and intercompany elimination.
- **Commentary**: deterministic drafts built only from computed drivers, with the numbers inlined. Your edits carry forward next month when the same driver recurs, with the numbers refreshed. Draft → reviewed → approved per line, with reviewer comments.
- **Actions**: printable board pack, Excel export of the variance table with commentary, flux checklist with owners and status.
- **History**: snapshot each close, follow an account's variance across months, compare two closes.
- **Workspace**: multiple close packs stored locally in IndexedDB; optional sign-in syncs them across devices.
- Two synthetic companies: a SaaS business with a marketing overspend and an early audit accrual, and a US/Canada distributor with intercompany to eliminate.

## Tested formats

The importer tests use excerpts laid out exactly like real exports: the QuickBooks Online General Ledger (older header-row layout and the current *Distribution account* layout), QuickBooks Profit and Loss Detail, and the current Xero Trial Balance (*Account Code / Account / Account Type / Debit - Year to date*). QuickBooks report amounts are signed by each account's normal balance and are converted back to debits and credits; Xero account types keep bank, receivable and payable accounts off the P&L.

## Xero year-to-date trial balances

Xero shows revenue and expense accounts from the first day of the financial year and balance sheet accounts at their closing balance (see Xero Central, *Trial Balance report*, summarised at [reportpost.app](https://reportpost.app/reports/xero-trial-balance-report)). Importing one file per month end gives monthly actuals:

- Revenue and expense accounts: month = this year to date minus the previous month's, per account, in whole cents. Balance sheet accounts (from Xero's *Account Type*) keep their closing balances. The months of a fiscal year add back to its last year to date exactly.
- The first month of the fiscal year needs no predecessor. The pack asks which month the fiscal year starts in the first time and remembers it (Data tab, *Year-to-date trial balances*); changing it recomputes everything.
- If the previous month's file is missing, that month is held back with a message and no figure is shown for it, so a year-to-date number is never presented as a month. A gap is never bridged: importing the missing month, in any order, fills both in.
- The year-to-date files are kept. Re-importing a month replaces it and recomputes the months around it. A later ledger (GL) import for the same entity and month takes precedence and the Data tab says so.
- Accounts that are new in a later file count in full that month. Xero hides nil balances, so an account missing from a later file is treated as zero and its whole year to date reverses that month, with a note. Credits and reversals are signed, so a falling revenue year to date becomes a debit.
- Most accounts shrinking at once usually means the fiscal year start is set wrongly, and is flagged.
- Non-year-to-date imports (GL detail, single-month trial balances, QuickBooks, NetSuite, Intacct) are unchanged.

## Known gaps

- Xero's Trial Balance carries year-to-date debit and credit columns. Successive month-end files of the same fiscal year are differenced into months (below); that needs every month from the start of the fiscal year, and the fiscal year start has to be chosen because the export does not contain it. Xero's optional *Debit - Month* columns are not read.
- Unnumbered QuickBooks accounts are classified by name when the report has no Income/Expenses sections (the General Ledger). Check the proposed mapping.

## Run locally

```
npm install
npm run dev
npm test
```

## Tests

- `npm test`: unit tests for the engine and the importers (Node's built-in runner, `src/**/*.test.ts`).
- `npm run test:e2e`: browser tests with Playwright (Chromium) against the **production build** served by `vite preview`. It builds first, so it never tests a stale build. Run `npx playwright install chromium` once (add `--with-deps` on a fresh Linux machine). Set `E2E_PORT` if port 4173 is taken; the suite refuses to reuse a server that is already running.

The browser tests run signed out, close the network to everything but the app (web fonts and Supabase are aborted), and fail on any uncaught page error, console error or outside request. They cover opening a sample, editing commentary and seeing it in the pack, importing synthetic actuals and a budget through to a variance, two successive Xero year-to-date trial balances (and a missing prior month), unreadable or wrong-format files, and persistence across a reload. The synthetic files are in `e2e/fixtures`.

GitHub Actions (`.github/workflows/ci.yml`) runs install, build, unit tests and the browser tests on every pull request and push to `main`.

Optional sync needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`. Without them everything runs locally.

Live: https://variance-pack.vercel.app
