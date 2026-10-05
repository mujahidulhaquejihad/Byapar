<p align="center">
  <img src="apps/web/public/byapar-logo.png" alt="Byapar" width="220" />
</p>

<h3 align="center">Byapar — ERP for Bangladeshi trading and manufacturing businesses</h3>

<p align="center">
  Accounting, purchasing, import LCs, inventory, sales, production, payroll and VAT on one general ledger, in Bangladeshi Taka (৳).
</p>

<p align="center">
  <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A522.13-339933?logo=node.js&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/react-vite-61DAFB?logo=react&logoColor=black" />
  <img alt="Database" src="https://img.shields.io/badge/database-SQLite-003B57?logo=sqlite&logoColor=white" />
  <img alt="Currency" src="https://img.shields.io/badge/currency-BDT%20%E0%A7%B3-006A4E" />
</p>

---

Byapar ("ব্যাপার", business) is a self-hosted ERP built for how a Bangladeshi company actually runs: July–June fiscal year, 15% VAT with Mushak documents, TDS on supplier payments, bKash/Nagad alongside bank accounts, LC-based imports, and provident fund on salaries. The demo company is **Jomadder Global Trade**, Tejgaon Industrial Area, Dhaka.

Everything runs from one Node process and one SQLite file — no database server to install.

## Features

**Finance (FICO)**
- Chart of accounts, journal entries, trial balance, period lock and approvals
- Accounts receivable and payable with partial payments, credit/debit notes (Mushak 6.7 / 6.8) and TDS on vendor payments
- Several bank accounts plus bKash and Nagad wallets, with MFS and bank charges booked automatically
- Bank reconciliation: import the bank's CSV, auto-match, match the rest by hand
- Fixed assets with a once-per-month depreciation run
- P&L, balance sheet, cash flow, year-end close to retained earnings
- AR/AP aging, customer and vendor ledgers, printable customer statement
- VAT return with register CSV export

**Materials (MM)**
- Material master, purchase orders, goods receipt and issue, lots, reorder alerts
- Import LCs with landed cost: LC margin, insurance, customs duty and C&F charges are added into stock value
- Stock valuation as of any date, reconciled to the inventory account

**Sales (SD)**
- Quotations (printable) that convert to sales orders, customer price lists
- Customer credit limits — orders over the limit go to approval
- Delivery, challan, gate pass, tax invoice (Mushak print), sales returns that put stock back

**Production (PP)**
- Bills of materials, work centers, production confirmation, MRP run

**HR & payroll**
- Employees, monthly salary (basic, house rent, medical, conveyance), provident fund on both sides, salary tax, festival bonus, printable payslips

**Security & operations**
- Role-based access, full audit trail, English / বাংলা interface
- Login lockout after 5 wrong passwords, admin password reset, changing a password signs out every other device
- Automatic daily database backups, CSV import

## Quick start

Requires **Node.js 22.13 or newer** (Byapar uses the built-in `node:sqlite` module).

```bash
git clone <this-repo-url> byapar
cd byapar
npm install
npm run dev
```

| Service | URL |
|---|---|
| Web app | http://localhost:5173 |
| API | http://localhost:8082 |

On first start the API creates the database and seeds the demo company.

### Demo logins

| Email | Password | Role |
|---|---|---|
| `admin@byapar.local` | `Admin@2027` | Full access |
| `accountant@byapar.local` | `Demo@2027` | Finance and payroll |
| `buyer@byapar.local` | `Demo@2027` | Purchasing |
| `sales@byapar.local` | `Demo@2027` | Order to cash |
| `planner@byapar.local` | `Demo@2027` | Production |

> **Before using real data:** change every demo password (click your name in the sidebar → My account), and remove or disable users you don't need under **Users & roles**.

To reset the demo, stop the app, delete `apps/api/data/erp_bd.sqlite*` and start again.

## Running in production

```bash
npm start
```

This builds the web app and serves it together with the API on **http://localhost:8082** — one process, one port.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8082` | API and web port |
| `ERP_DB_PATH` | `apps/api/data/erp_bd.sqlite` | Database file location |
| `JWT_SECRET` | random, stored in the database | Login token signing key. Set it if you want to manage it yourself |

## Backups

While the API runs it copies the database every 24 hours into `C:\Users\<you>\Byapar Backups` (or `~/Byapar Backups`) and keeps the newest 14. Change the folder under **Import / backup** — another drive, a USB disk or a synced cloud folder are all good choices. You can also download a backup on demand from the same page.

To restore: stop Byapar, copy a backup over `apps/api/data/erp_bd.sqlite`, delete the `-wal` and `-shm` files beside it, and start again.

## Accounting conventions

| Item | Setting |
|---|---|
| Currency | BDT (৳), stored as paisa (integer) |
| Fiscal year | 1 July – 30 June |
| VAT | 15%, output and input on account 2300 |
| TDS / salary tax | Payable on account 2500 |
| Cash and bank | Any account in the range 1000–1199 (petty cash, DBBL, City Bank, bKash, Nagad) |
| Import LCs | Goods in transit on 1350 until allocated to inventory (1300) |

Every module posts through a single posting service: journals must balance, and nothing can post into a closed period.

## Project structure

```
apps/
  api/                 Express API (Node, node:sqlite)
    src/
      modules/         fico, mm, sd, pp, hr, security, extras (reports, printing, backups)
      posting.js       The only code that writes journals
      schema.sql       Database schema
      seed.js          Demo company
    test/              node:test suite
  web/                 React + Vite front end
    src/pages/         One file per screen
```

## Tests

```bash
npm test
```

Covers the posting rules, payments and notes, returns, TDS, bKash fees, LC allocation, payroll, credit limits, financial statements, year-end close, login lockout and backups. Tests run against a temporary database and never touch your data.

## Tech stack

Node.js · Express · SQLite (`node:sqlite`) · React · Vite · React Router · Zod · JWT · bcrypt
