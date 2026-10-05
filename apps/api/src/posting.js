/**
 * GL posting service — the only module allowed to write journal_headers / journal_lines.
 * FICO, MM, SD, and PP must post through postJournal(). Balanced entries are mandatory.
 */
import { all, get, run, nextNumber, cents } from "./db.js";

// ponytail: "cash account" = GL code 1000–1199 (cash, banks, bKash/Nagad); add an is_cash flag if the chart outgrows the range.
export const CASH_RANGE = "BETWEEN '1000' AND '1199'";
export const cashAccounts = () => all(`SELECT code, name FROM gl_accounts WHERE code ${CASH_RANGE} ORDER BY code`);

/** Returns the code if it is a cash / bank / wallet account, else throws 400. */
export function cashAccount(code = "1100") {
  if (!cashAccounts().some((a) => a.code === code)) throw Object.assign(new Error(`Account ${code} is not a cash, bank or wallet account`), { status: 400 });
  return code;
}

/** Drops zero lines so callers can list optional legs (VAT, TDS, fees) unconditionally. */
export const nonZero = (lines) => lines.filter((l) => (l.debit || 0) + (l.credit || 0) > 0);

function assertPeriodOpen(postingDate) {
  const period = get(
    `SELECT * FROM fiscal_periods WHERE start_date <= ? AND end_date >= ? LIMIT 1`,
    [postingDate, postingDate]
  );
  if (period && period.status === "closed") {
    throw Object.assign(new Error(`Fiscal period ${period.code} is locked — cannot post`), { status: 403 });
  }
}

export function postJournal(db, { date, postingDate, sourceModule, sourceId, description, lines, userId, costCenterId }) {
  if (!lines?.length) throw Object.assign(new Error("Journal has no lines"), { status: 400 });
  const pd = postingDate || date;
  assertPeriodOpen(pd);

  const prepared = lines.map((line, i) => {
    const account = get("SELECT id, code, name, is_posting FROM gl_accounts WHERE code = ?", [line.accountCode]);
    if (!account) throw Object.assign(new Error(`Unknown GL account ${line.accountCode}`), { status: 400 });
    if (!account.is_posting) throw Object.assign(new Error(`Account ${line.accountCode} is not a posting account`), { status: 400 });
    const debit = cents(line.debit || 0);
    const credit = cents(line.credit || 0);
    if (debit < 0 || credit < 0) throw Object.assign(new Error("Amounts cannot be negative"), { status: 400 });
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      throw Object.assign(new Error(`Line ${i + 1} must have either a debit or a credit`), { status: 400 });
    }
    return { account, debit, credit, text: line.text || description || "" };
  });

  const debitTotal = prepared.reduce((s, l) => s + l.debit, 0);
  const creditTotal = prepared.reduce((s, l) => s + l.credit, 0);
  if (debitTotal !== creditTotal) {
    throw Object.assign(
      new Error(`Journal is not balanced: debit ${debitTotal / 100} ≠ credit ${creditTotal / 100}`),
      { status: 400 }
    );
  }

  const docNumber = nextNumber("JOURNAL");
  const header = run(
    `INSERT INTO journal_headers (doc_number, doc_date, posting_date, source_module, source_id, description, created_by, cost_center_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      docNumber,
      date,
      pd,
      sourceModule,
      sourceId != null ? String(sourceId) : null,
      description,
      userId ?? null,
      costCenterId ?? null,
    ]
  );

  prepared.forEach((line, i) => {
    run(
      `INSERT INTO journal_lines (header_id, line_no, account_id, debit_cents, credit_cents, text)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [header.lastInsertRowid, i + 1, line.account.id, line.debit, line.credit, line.text]
    );
  });

  return { id: Number(header.lastInsertRowid), docNumber, debitTotal, creditTotal };
}

export function accountBalance(accountCode) {
  const row = get(
    `SELECT
        a.code, a.name, a.type, a.is_contra,
        COALESCE(SUM(l.debit_cents), 0) AS debit,
        COALESCE(SUM(l.credit_cents), 0) AS credit
     FROM gl_accounts a
     LEFT JOIN journal_lines l ON l.account_id = a.id
     LEFT JOIN journal_headers h ON h.id = l.header_id AND h.status = 'posted'
     WHERE a.code = ?
     GROUP BY a.id`,
    [accountCode]
  );
  if (!row) return null;
  const natural = ["asset", "expense"].includes(row.type) ? row.debit - row.credit : row.credit - row.debit;
  const signed = row.is_contra ? -natural : natural;
  return { ...row, balance_cents: signed };
}
