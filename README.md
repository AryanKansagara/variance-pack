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

## Known gaps

- The current Xero Trial Balance only has year-to-date debit and credit columns; the import warns, but does not difference successive months for you. Use Account Transactions for monthly actuals.
- Unnumbered QuickBooks accounts are classified by name when the report has no Income/Expenses sections (the General Ledger). Check the proposed mapping.

## Run locally

```
npm install
npm run dev
npm test
```

Optional sync needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`. Without them everything runs locally.

Live: https://variance-pack.vercel.app
