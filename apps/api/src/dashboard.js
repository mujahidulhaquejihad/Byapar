import { all, get, money } from "./db.js";
import { CASH_RANGE } from "./posting.js";

function trialBalances() {
  return all(
    `SELECT a.code, a.name, a.type, a.is_contra,
            COALESCE(SUM(l.debit_cents), 0) AS debit_cents,
            COALESCE(SUM(l.credit_cents), 0) AS credit_cents
     FROM gl_accounts a
     LEFT JOIN journal_lines l ON l.account_id = a.id
     LEFT JOIN journal_headers h ON h.id = l.header_id AND h.status = 'posted'
     GROUP BY a.id`
  );
}

function balOf(tb, code) {
  const a = tb.find((x) => x.code === code);
  if (!a) return 0;
  const natural = ["asset", "expense"].includes(a.type) ? a.debit_cents - a.credit_cents : a.credit_cents - a.debit_cents;
  return money(a.is_contra ? -natural : natural);
}

export function dashboard() {
  const tb = trialBalances();
  const bal = (code) => balOf(tb, code);

  const openAp = get("SELECT COALESCE(SUM(amount_cents - settled_cents),0) AS c FROM ap_invoices WHERE status IN ('open','partial')");
  const openAr = get("SELECT COALESCE(SUM(amount_cents - settled_cents),0) AS c FROM ar_invoices WHERE status IN ('open','partial')");
  const inv = all(`SELECT i.qty_on_hand, m.std_price_cents FROM inventory i JOIN materials m ON m.id = i.material_id`);
  const inventoryValue = money(inv.reduce((s, r) => s + Math.round(r.qty_on_hand * r.std_price_cents), 0));

  const company = get("SELECT * FROM company_profile WHERE id = 1") || {
    name: "Jomadder Global Trade",
    legal_name: "Jomadder Global Trade",
    fiscal_year: 2026,
    currency: "BDT",
  };

  return {
    company: company.legal_name,
    shortName: company.name,
    fiscalYear: company.fiscal_year,
    fiscalLabel: "FY 2025–26",
    currency: company.currency || "BDT",
    currencySymbol: "৳",
    country: "Bangladesh",
    city: "Dhaka",
    kpis: {
      cash: money(get(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents),0) AS c FROM journal_lines l JOIN gl_accounts a ON a.id = l.account_id WHERE a.code ${CASH_RANGE}`).c),
      bank: bal("1100"),
      inventory: inventoryValue,
      ar: money(openAr.c),
      ap: money(openAp.c),
      revenue: bal("4000"),
      cogs: bal("5000"),
      grossMargin: bal("4000") - bal("5000"),
      assets: bal("1500") - bal("1510"),
    },
    pipeline: {
      openPurchaseOrders: get("SELECT COUNT(*) AS n FROM purchase_orders WHERE status IN ('open','partial')").n,
      openSalesOrders: get("SELECT COUNT(*) AS n FROM sales_orders WHERE status IN ('open','partial','delivered')").n,
      openProduction: get("SELECT COUNT(*) AS n FROM production_orders WHERE status IN ('released','in_progress')").n,
      openApInvoices: get("SELECT COUNT(*) AS n FROM ap_invoices WHERE status IN ('open','partial')").n,
      openArInvoices: get("SELECT COUNT(*) AS n FROM ar_invoices WHERE status IN ('open','partial')").n,
    },
    recentJournals: all(
      `SELECT id, doc_number, posting_date, source_module, description FROM journal_headers ORDER BY id DESC LIMIT 10`
    ),
    postingRule: "Every Mushak-linked MM/SD/FICO document posts through one GL service in Bangladeshi Taka (BDT). Unbalanced journals are rejected.",
  };
}

/* ——— Financial statements ——— */

/** Per-account debit-minus-credit for posted journals dated from..to; optionally ignoring year-end closing entries. */
export function balancesBetween(from, to, { excludeClose = false } = {}) {
  return all(
    `SELECT a.code, a.name, a.type, COALESCE(SUM(x.debit_cents - x.credit_cents), 0) AS dr
     FROM gl_accounts a
     LEFT JOIN (
       SELECT l.account_id, l.debit_cents, l.credit_cents FROM journal_lines l
       JOIN journal_headers h ON h.id = l.header_id
       WHERE h.status = 'posted' AND h.posting_date BETWEEN ? AND ? ${excludeClose ? "AND h.source_module <> 'YEAR_END'" : ""}
     ) x ON x.account_id = a.id
     GROUP BY a.id ORDER BY a.code`,
    [from, to]
  );
}

/** First day after the last closed fiscal year (or the beginning of time). */
export function openYearStart() {
  const last = get("SELECT MAX(fy_end) AS d FROM year_closes").d;
  return last ? new Date(Date.parse(last) + 86400000).toISOString().slice(0, 10) : "0000-01-01";
}

export function pnlReport(from = openYearStart(), to = new Date().toISOString().slice(0, 10)) {
  const rows = balancesBetween(from, to, { excludeClose: true }).filter((r) => r.dr !== 0);
  const revenue = rows.filter((r) => r.type === "revenue");
  const cogs = rows.filter((r) => r.code === "5000");
  const opex = rows.filter((r) => r.type === "expense" && r.code !== "5000");
  const sum = (list, sign) => list.reduce((s, r) => s + sign * r.dr, 0);
  const rev = sum(revenue, -1);
  const gross = rev - sum(cogs, 1);
  const operating = gross - sum(opex, 1);
  return {
    from,
    to,
    revenue: money(rev),
    cogs: money(sum(cogs, 1)),
    grossProfit: money(gross),
    operatingExpenses: money(sum(opex, 1)),
    operatingIncome: money(operating),
    lines: [
      ...revenue.map((r) => ({ label: r.name, amount: money(-r.dr) })),
      ...cogs.map((r) => ({ label: r.name, amount: money(-r.dr) })),
      { label: "Gross profit", amount: money(gross), emphasize: true },
      ...opex.map((r) => ({ label: r.name, amount: money(-r.dr) })),
      { label: "Net profit", amount: money(operating), emphasize: true },
    ],
  };
}

export function balanceSheet(asOf = new Date().toISOString().slice(0, 10)) {
  const rows = balancesBetween("0000-01-01", asOf);
  const section = (type, sign) =>
    rows.filter((r) => r.type === type && r.dr !== 0).map((r) => ({ code: r.code, name: r.name, amount: money(sign * r.dr) }));
  const profitCents = -rows.filter((r) => r.type === "revenue" || r.type === "expense").reduce((s, r) => s + r.dr, 0);
  const assets = section("asset", 1);
  const liabilities = section("liability", -1);
  const equity = section("equity", -1);
  if (profitCents) equity.push({ code: "", name: "Profit not yet closed to retained earnings", amount: money(profitCents) });
  const total = (list) => Math.round(list.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  return {
    asOf,
    assets,
    liabilities,
    equity,
    totalAssets: total(assets),
    totalLiabilities: total(liabilities),
    totalEquity: total(equity),
    balanced: total(assets) === Math.round((total(liabilities) + total(equity)) * 100) / 100,
  };
}

const cashCategory = (r) => (r.code.startsWith("15") ? "investing" : r.type === "equity" || r.code === "2400" ? "financing" : "operating");

/** Direct cash flow: for journals touching cash/bank/wallet accounts, each other line's (credit − debit) is its cash effect. */
export function cashFlow(from = openYearStart(), to = new Date().toISOString().slice(0, 10)) {
  const cashAt = (op, d) =>
    get(
      `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents),0) AS c FROM journal_lines l
       JOIN journal_headers h ON h.id = l.header_id JOIN gl_accounts a ON a.id = l.account_id
       WHERE h.status = 'posted' AND a.code ${CASH_RANGE} AND h.posting_date ${op} ?`,
      [d]
    ).c;
  const lines = all(
    `SELECT a.code, a.name, a.type, SUM(l.credit_cents - l.debit_cents) AS effect
     FROM journal_lines l JOIN journal_headers h ON h.id = l.header_id JOIN gl_accounts a ON a.id = l.account_id
     WHERE h.status = 'posted' AND h.posting_date BETWEEN ? AND ? AND a.code NOT ${CASH_RANGE}
       AND h.id IN (SELECT l2.header_id FROM journal_lines l2 JOIN gl_accounts a2 ON a2.id = l2.account_id WHERE a2.code ${CASH_RANGE})
     GROUP BY a.id HAVING effect <> 0 ORDER BY a.code`,
    [from, to]
  );
  const sections = ["operating", "investing", "financing"].map((key) => {
    const items = lines.filter((l) => cashCategory(l) === key);
    return {
      key,
      items: items.map((l) => ({ code: l.code, name: l.name, amount: money(l.effect) })),
      total: money(items.reduce((s, l) => s + l.effect, 0)),
    };
  });
  const opening = cashAt("<", from);
  const closing = cashAt("<=", to);
  return { from, to, opening: money(opening), closing: money(closing), netChange: money(closing - opening), sections };
}
