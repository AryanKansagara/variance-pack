import { Code, Link } from './ui.tsx'

const GENERIC_GL = `entity,period,date,account,account_name,vendor,department,memo,debit,credit,units
US,2026-10,2026-10-03,6100,Advertising and media,Acme Media,Marketing,New campaign invoice,35000.00,,
US,2026-10,2026-10-03,2000,Accounts payable,Acme Media,,New campaign invoice,,35000.00,
US,2026-10,2026-10-31,4000,Subscription revenue,Enterprise,,October billing,,212400.00,4290`

const GENERIC_BUDGET = `account,Jan 2026,Feb 2026,Mar 2026,...,Dec 2026
4000 Subscription revenue,410000,418000,425500,...,495000
6100 Advertising and media,148000,148000,152000,...,160000`

const GENERIC_BUDGET_LONG = `entity,period,account,amount,units
US,2026-10,4000,452870,9845
US,2026-10,6100,148000,`

const MAPPING = `account,name,line,section,kind,intercompany
4000,Subscription revenue,Subscription revenue,Revenue,revenue,
4900,Intercompany management fee income,Intercompany,Revenue,revenue,yes
6100,Advertising and media,Sales & marketing,Operating expenses,expense,
6900,Intercompany management fee expense,Intercompany,Operating expenses,expense,yes`

const NS_COLUMNS = `Criteria:  Posting = true
           Accounting Period = (current month and the 13 before it)
           Account : Type = any of Income, Cost of Goods Sold, Expense,
                            Other Income, Other Expense   (omit for a full TB)
Results:   Date, Posting Period, Type, Document Number, Name, Account,
           Memo, Amount (Debit), Amount (Credit), Department, Subsidiary,
           Quantity`

export default function Docs() {
  return (
    <article className="page docs">
      <aside className="docs-nav" aria-label="On this page">
        <a href="#inputs">What to import</a>
        <a href="#qbo">QuickBooks Online</a>
        <a href="#xero">Xero</a>
        <a href="#netsuite">NetSuite</a>
        <a href="#intacct">Sage Intacct</a>
        <a href="#generic">Generic layout</a>
        <a href="#method">How variances are computed</a>
        <a href="#privacy">Where your data lives</a>
      </aside>
      <div className="docs-body">
        <p className="eyebrow">Docs</p>
        <h1>Getting actuals and budgets out of your ledger</h1>
        <p className="lede">Menu paths below were checked against each vendor's help documentation in November 2026. Report names move between editions and releases; if a menu differs in your account, the column list is what matters.</p>

        <h2 id="inputs">What to import</h2>
        <ol>
          <li><b>Actuals, current and prior months.</b> GL detail is best: vendor and memo per line is what lets the app name drivers. A trial balance works too, but variances will say “no GL detail isolates a driver”. Bring 13 months or more if you want year-over-year and run-rate drivers.</li>
          <li><b>Budget or forecast</b> for the same months, one row per account per month or one column per month.</li>
          <li><b>Optional: a chart-of-accounts mapping</b> into P&amp;L lines. Without one, accounts are mapped by number range (4xxx revenue, 5xxx cost of revenue, 6–7xxx operating, 8–9xxx other) and name, and you can edit every line.</li>
          <li><b>Optional: a trial balance for tie-out.</b> Import it after the GL and tick “use only to tie out”. Any account whose TB balance differs from the sum of GL lines is listed.</li>
        </ol>
        <p>Debits must equal credits per entity and month. A P&amp;L-only extract will not balance by design; the check says so instead of failing.</p>

        <h2 id="qbo">QuickBooks Online</h2>
        <h3>Actuals: Journal report</h3>
        <ol>
          <li><b>Reports</b>, search for <b>Journal</b>.</li>
          <li>Set <b>Report period</b> to a custom range covering the months you want (for example Oct 1, 2025 to Oct 31, 2026).</li>
          <li><b>Customize → Rows/Columns → Change columns</b>: keep Date, Transaction Type, Num, Name, Memo/Description, Account, Debit, Credit. Add Class or Location if you report entities that way.</li>
          <li><b>Export → Export to Excel</b>. Import the .xlsx as is; the title rows above the header are skipped.</li>
        </ol>
        <p>The <b>Trial Balance</b> report also works (one month per export, pick the period on import). The <b>General Ledger</b> and <b>Profit and Loss Detail</b> reports import as they come out of <b>Export → Export to CSV</b>, in both the older layout (account as a header row) and the current one with a <i>Distribution account</i> column. Their single Amount column is signed by each account&rsquo;s normal balance (an invoice is positive on an income account), so the importer turns it back into debits and credits: from the account number when there is one (2xxx to 4xxx are credit-normal), otherwise from the report section (Income vs Expenses) or the account name. Beginning Balance, Total for and Net Income rows are skipped, and a single-month title such as &ldquo;August 1-31, 2026&rdquo; fills in the period.</p>
        <h3>Budget: Budget Overview</h3>
        <p>Budgets need QuickBooks Online Plus or Advanced. <b>Settings (gear) → Budgeting</b>, pick the budget, <b>Run budgets overview report</b>, then <b>Export to Excel</b>. It has one column per month, which is detected.</p>

        <h2 id="xero">Xero</h2>
        <h3>Actuals: Account Transactions</h3>
        <ol>
          <li><b>Accounting → Reports → Account Transactions</b>.</li>
          <li>Select all revenue and expense accounts (or all accounts for a full ledger), set the date range.</li>
          <li>In <b>Columns</b>, include Date, Source, Description, Reference, Contact, Debit, Credit and Account. Contact becomes the vendor driver.</li>
          <li><b>Export → Excel</b>.</li>
        </ol>
        <p><b>Trial Balance</b> (Accounting → Reports → Trial Balance): older exports show Account as &ldquo;Advertising (400)&rdquo; and the code in brackets is extracted; the current export has separate <i>Account Code</i>, <i>Account</i> and <i>Account Type</i> columns, all read. The month comes from the &ldquo;As at 31 October 2025&rdquo; title. Two things to know:</p>
        <ul>
          <li>The current export only has <i>Debit - Year to date</i> and <i>Credit - Year to date</i>. For revenue and expense accounts that is the year so far, not the month, and the import warns you. Use Account Transactions for monthly actuals and keep the trial balance as the tie-out file.</li>
          <li>Xero&rsquo;s default chart numbers bank as 090, receivables 610 and payables 800, so the account code alone cannot tell balance sheet from P&amp;L. <i>Account Type</i> (Bank, Current Asset, Current Liability, Equity and so on) is used instead, and those accounts are left off the P&amp;L mapping.</li>
        </ul>
        <h3>Budget</h3>
        <p><b>Accounting → Reports → Budget Manager</b>, choose the budget and period, then <b>Export → Excel</b>. Or run the <b>Budget Summary</b> report by month and export.</p>

        <h2 id="netsuite">NetSuite</h2>
        <h3>Actuals: a transaction saved search</h3>
        <ol>
          <li><b>Reports → Saved Searches → All Saved Searches → New → Transaction</b>.</li>
          <li>Set the criteria and results below. On OneWorld accounts, Subsidiary becomes the entity.</li>
          <li>Save, run, then use <b>Export - CSV</b> in the results header.</li>
        </ol>
        <Code label="Saved search" code={NS_COLUMNS} />
        <p>Using Amount (Debit) and Amount (Credit) keeps the export on GL impact lines. Do not tick “Main Line” in the criteria, or only the header line of each transaction is returned.</p>
        <h3>Budget</h3>
        <p><b>Reports → Financial → Budget Income Statement</b>, set the column layout to months, then <b>Export → CSV</b>. Or export the budget import template from <b>Transactions → Financial → Set Up Budgets</b>.</p>

        <h2 id="intacct">Sage Intacct</h2>
        <h3>Actuals: General Ledger report</h3>
        <ol>
          <li><b>Reports → General Ledger → General ledger</b> (or <b>General Ledger → Reports → General ledger</b>, depending on your menu).</li>
          <li>Choose the reporting period range and accounts. Under <b>Format</b>, include vendor/customer name and department dimensions.</li>
          <li>Run as <b>Excel</b> or <b>CSV</b>. Columns such as Account no, Account title, Date, Memo, Debit, Credit are recognised.</li>
        </ol>
        <h3>Budget</h3>
        <p><b>General Ledger → Budgets</b>, open the budget, <b>Export</b> to CSV. Entity-level budgets import best with an entity column.</p>

        <h2 id="generic">Generic layout</h2>
        <p>Anything with an account column plus either debit/credit or a signed amount (debit positive) imports. Period comes from a period column, a date, or a month you pick. Column names are matched loosely and every mapping can be changed before import.</p>
        <Code label="GL detail (CSV)" code={GENERIC_GL} />
        <Code label="Budget, one column per month" code={GENERIC_BUDGET} />
        <Code label="Budget, long format" code={GENERIC_BUDGET_LONG} />
        <Code label="Chart-of-accounts mapping" code={MAPPING} />
        <p className="small muted">Amounts may use $, thousands separators, (parentheses) or trailing minus for negatives. Dates may be ISO, US m/d/y, day-first when unambiguous, or “Oct 2026”.</p>

        <h2 id="method">How variances are computed</h2>
        <ul>
          <li><b>Natural sign.</b> Revenue is credit minus debit, expense is debit minus credit, so both are positive in normal months. Revenue above budget is favourable; expense above budget is unfavourable.</li>
          <li><b>Materiality.</b> Flagged only when both |variance| ≥ the dollar threshold and |variance| / |comparison| ≥ the percent threshold. With no comparison amount, the dollar test alone applies.</li>
          <li><b>Drivers.</b> GL lines for the account are grouped by vendor, then department. Against budget, each vendor is compared to its average over the prior three months (budgets rarely carry vendors); month-over-month and year-over-year compare to that vendor in the comparison month. The largest movers in the direction of the variance are kept until they explain 80%. Tags: new (no spend in three months), one-off (one entry carrying most of the movement, well above run-rate), accrual (memo mentions accrual, reversal, prepaid or true-up, or the amount reverses next month).</li>
          <li><b>Timing.</b> A budget variance is called timing when the next month (or the prior month) has an opposite variance of 50–150% of its size, or when its driver is an accrual.</li>
          <li><b>Price and volume.</b> Where both actual and budget carry units: volume = (actual units − budget units) × budget price; price = (actual price − budget price) × actual units. They sum to the variance.</li>
          <li><b>Consolidation.</b> Each entity's actuals and budget are multiplied by its FX rate. Accounts marked intercompany are removed; the residual of all intercompany lines is shown so you can see whether both sides were booked at the same rate.</li>
          <li><b>Commentary.</b> Templates filled only from those computed facts. When you edit a line, the edit is saved with the numbers it contained. Next month, if the same account has the same top driver, your wording is reused with the new numbers swapped in.</li>
        </ul>

        <h2 id="privacy">Where your data lives</h2>
        <p>Files are parsed in your browser and stored in this browser's IndexedDB. Nothing is uploaded unless you sign in. Signing in (optional) syncs packs across devices: mapping, settings, commentary, checklists and snapshots always sync; a ledger over 1.5 MB stays on the device where it was imported. You can export everything as JSON, delete your cloud data, or delete your account from the account menu.</p>
        <p><Link href="/app" className="btn primary">Open your close packs</Link></p>
      </div>
    </article>
  )
}
