import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDb = path.join(__dirname, "data", `test-${process.pid}.sqlite`);

process.env.ERP_DB_PATH = tmpDb;
process.env.PORT = "0";

const { openDb, get, all, run, tx, cents, money } = await import("../src/db.js");
const { migrate } = await import("../src/migrate.js");
const { seedIfEmpty } = await import("../src/seed.js");
const { postJournal } = await import("../src/posting.js");

openDb();
migrate();
seedIfEmpty();

after(() => {
  try {
    fs.unlinkSync(tmpDb);
    fs.unlinkSync(tmpDb + "-wal");
    fs.unlinkSync(tmpDb + "-shm");
  } catch {
    /* ignore */
  }
});

describe("GL posting", () => {
  it("rejects unbalanced journals", () => {
    assert.throws(
      () =>
        tx((db) =>
          postJournal(db, {
            date: "2026-02-10",
            postingDate: "2026-02-10",
            sourceModule: "TEST",
            sourceId: "1",
            description: "bad",
            lines: [
              { accountCode: "1100", debit: 100, text: "a" },
              { accountCode: "2000", credit: 90, text: "b" },
            ],
            userId: 1,
          })
        ),
      /not balanced/
    );
  });

  it("posts balanced journal and keeps TB balanced", () => {
    tx((db) =>
      postJournal(db, {
        date: "2026-02-10",
        postingDate: "2026-02-10",
        sourceModule: "TEST",
        sourceId: "ok",
        description: "balanced test",
        lines: [
          { accountCode: "5900", debit: 1000, text: "expense" },
          { accountCode: "1100", credit: 1000, text: "bank" },
        ],
        userId: 1,
      })
    );
    const rows = all(
      `SELECT a.code,
              COALESCE(SUM(l.debit_cents),0) - COALESCE(SUM(l.credit_cents),0) AS net
       FROM gl_accounts a
       LEFT JOIN journal_lines l ON l.account_id = a.id
       GROUP BY a.id`
    );
    const sum = rows.reduce((s, r) => s + r.net, 0);
    assert.equal(sum, 0);
  });

  it("blocks posting into closed fiscal periods", () => {
    // Seed already closes 2025-07 after opening balance
    assert.throws(
      () =>
        tx((db) =>
          postJournal(db, {
            date: "2025-07-15",
            postingDate: "2025-07-15",
            sourceModule: "TEST",
            sourceId: "locked",
            description: "should fail",
            lines: [
              { accountCode: "5900", debit: 10, text: "x" },
              { accountCode: "1100", credit: 10, text: "y" },
            ],
            userId: 1,
          })
        ),
      /locked/
    );
  });

  it("VAT math on seed AR is 15%", () => {
    const inv = get("SELECT * FROM ar_invoices WHERE invoice_no = 'AR-2026-00001'");
    assert.ok(inv);
    const net = inv.amount_cents - inv.tax_cents;
    assert.equal(Math.round(net * 0.15), inv.tax_cents);
  });

  it("money/cents helpers round-trip", () => {
    assert.equal(cents(14500.5), 1450050);
    assert.equal(money(1450050), 14500.5);
  });
});

/* ——— Feature checks through the real routers (fake auth as admin) ——— */
const express = (await import("express")).default;
const { loadUser } = await import("../src/auth.js");
const { ficoRouter, runDepreciation } = await import("../src/modules/fico.js");
const { sdRouter } = await import("../src/modules/sd.js");
const { extrasRouter, autoMatch, toCsv } = await import("../src/modules/extras.js");
const { snapshot } = await import("../src/backup.js");
const { DatabaseSync } = await import("node:sqlite");

const app = express();
app.use(express.json());
app.use((req, _res, next) => ((req.user = loadUser(1)), next()));
app.use("/fico", ficoRouter);
app.use("/sd", sdRouter);
app.use("/ops", extrasRouter);
const server = app.listen(0);
after(() => server.close());
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const journalBalanced = (docNumber) => {
  const r = get(
    `SELECT SUM(l.debit_cents) d, SUM(l.credit_cents) c FROM journal_lines l JOIN journal_headers h ON h.id = l.header_id WHERE h.doc_number = ?`,
    [docNumber]
  );
  return r.d === r.c && r.d > 0;
};

describe("settlements, notes, TDS", () => {
  it("AR: partial receipt → partial, overpay rejected, rest → paid", async () => {
    const { body } = await call("POST", "/fico/ar-invoices", { customerId: 1, invoiceDate: "2026-03-01", amount: 11500, tax: 1500, description: "t" });
    const id = body.invoice.id;
    const r1 = await call("POST", `/fico/ar-invoices/${id}/receive`, { amount: 5000 });
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.ok(journalBalanced(r1.body.journal));
    assert.deepEqual({ ...get("SELECT status, settled_cents FROM ar_invoices WHERE id = ?", [id]) }, { status: "partial", settled_cents: 500000 });
    assert.equal((await call("POST", `/fico/ar-invoices/${id}/receive`, { amount: 7000 })).status, 400);
    await call("POST", `/fico/ar-invoices/${id}/receive`, {});
    assert.equal(get("SELECT status FROM ar_invoices WHERE id = ?", [id]).status, "paid");
  });

  it("AR credit note reverses VAT in proportion", async () => {
    const { body } = await call("POST", "/fico/ar-invoices", { customerId: 1, invoiceDate: "2026-03-01", amount: 11500, tax: 1500, description: "cn" });
    const r = await call("POST", `/fico/ar-invoices/${body.invoice.id}/credit-note`, { amount: 2300, reason: "returned" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const note = get("SELECT * FROM invoice_notes WHERE invoice_id = ?", [body.invoice.id]);
    assert.equal(note.tax_cents, 30000); // 2300 × 1500/11500
    assert.equal(get("SELECT settled_cents FROM ar_invoices WHERE id = ?", [body.invoice.id]).settled_cents, 230000);
  });

  it("AP payment with TDS credits 2500 and stays balanced", async () => {
    const { body } = await call("POST", "/fico/ap-invoices", { vendorId: 1, invoiceDate: "2026-03-01", amount: 10000, tax: 0, description: "svc" });
    const r = await call("POST", `/fico/ap-invoices/${body.invoice.id}/pay`, { amount: 10000, tds: 1000 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(journalBalanced(r.body.journal));
    const tds = get(
      `SELECT l.credit_cents c FROM journal_lines l JOIN journal_headers h ON h.id = l.header_id JOIN gl_accounts a ON a.id = l.account_id
       WHERE h.doc_number = ? AND a.code = '2500'`,
      [r.body.journal]
    );
    assert.equal(tds.c, 100000);
  });
});

describe("month end, sales, bank, backup", () => {
  it("depreciation runs once per month", () => {
    const r = tx((db) => runDepreciation(db, "2026-02", 1));
    assert.ok(r.amount > 0 && journalBalanced(r.journal));
    assert.throws(() => tx((db) => runDepreciation(db, "2026-02", 1)), /already posted/);
    assert.throws(() => tx((db) => runDepreciation(db, "2999-01", 1)), /not ended/);
  });

  it("quotation converts to a sales order exactly once", async () => {
    const mat = get("SELECT id FROM materials WHERE type = 'finished' LIMIT 1");
    const q = await call("POST", "/sd/quotations", { customerId: 1, lines: [{ materialId: mat.id, qty: 2, unitPrice: 100 }] });
    assert.equal(q.status, 201, JSON.stringify(q.body));
    const c = await call("POST", `/sd/quotations/${q.body.quotation.id}/convert`);
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal(c.body.salesOrder.lines[0].qty, 2);
    assert.equal((await call("POST", `/sd/quotations/${q.body.quotation.id}/convert`)).status, 400);
  });

  it("price list price wins over standard markup", async () => {
    const mat = get("SELECT id FROM materials WHERE type = 'finished' LIMIT 1");
    await call("POST", "/sd/price-lists", { customerId: 1, materialId: mat.id, unitPrice: 1000, discountPct: 10 });
    const p = await call("GET", `/sd/price?customerId=1&materialId=${mat.id}`);
    assert.deepEqual(p.body, { unitPrice: 900, source: "price_list" });
  });

  it("bank auto-match pairs unique amount+date hits, skips ambiguous", () => {
    const stmt = [
      { id: 1, stmt_date: "2026-03-02", amount_cents: 500 },
      { id: 2, stmt_date: "2026-03-10", amount_cents: 700 },
      { id: 3, stmt_date: "2026-03-20", amount_cents: 900 },
    ];
    const gl = [
      { id: 10, posting_date: "2026-03-01", amount_cents: 500 },
      { id: 11, posting_date: "2026-03-09", amount_cents: 700 },
      { id: 12, posting_date: "2026-03-11", amount_cents: 700 },
      { id: 13, posting_date: "2026-03-01", amount_cents: 900 },
    ];
    assert.deepEqual(autoMatch(stmt, gl), [[1, 10]]);
  });

  it("CSV quotes commas and quotes", () => {
    assert.equal(toCsv([{ a: 'x,"y"', b: 1 }], ["a", "b"]), 'a,b\r\n"x,""y""",1');
  });

  it("backup snapshot is a readable copy", () => {
    const file = path.join(__dirname, "data", `snap-${process.pid}.sqlite`);
    snapshot(file);
    const copy = new DatabaseSync(file);
    assert.ok(copy.prepare("SELECT COUNT(*) n FROM users").get().n > 0);
    copy.close();
    fs.rmSync(file);
  });
});

const { hrRouter } = await import("../src/modules/hr.js");
const { mmRouter, allocateLc } = await import("../src/modules/mm.js");
const { balanceSheet, cashFlow, balancesBetween } = await import("../src/dashboard.js");
const { closeYear } = await import("../src/modules/fico.js");
const { signToken, authRequired } = await import("../src/auth.js");
const { loginLocked, recordLoginFailure, clearLoginFailures } = await import("../src/modules/security.js");
app.use("/hr", hrRouter);
app.use("/mm", mmRouter);

describe("returns, credit, MFS, LC, payroll, security", () => {
  it("sales return puts stock back and books Dr 1300 / Cr 5000", async () => {
    const mat = get("SELECT id, std_price_cents FROM materials WHERE type = 'finished' LIMIT 1");
    const loc = get("SELECT id FROM storage_locations LIMIT 1");
    const onHand = () => get("SELECT COALESCE(SUM(qty_on_hand),0) q FROM inventory WHERE material_id = ? AND storage_location_id = ?", [mat.id, loc.id]).q;
    const before = onHand();
    const { body } = await call("POST", "/fico/ar-invoices", { customerId: 1, invoiceDate: "2026-03-01", amount: 11500, tax: 1500, description: "ret" });
    const r = await call("POST", `/fico/ar-invoices/${body.invoice.id}/credit-note`, { amount: 1150, reason: "returned", stock: { materialId: mat.id, qty: 3, storageLocationId: loc.id } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(onHand(), before + 3);
    assert.equal(get("SELECT movement_type FROM goods_movements WHERE ref_type = 'SRET' AND material_id = ?", [mat.id])?.movement_type, "GR");
  });

  it("order over the credit limit goes to approval", async () => {
    const mat = get("SELECT id FROM materials WHERE type = 'finished' LIMIT 1");
    const c = get("SELECT payment_terms, tax_id, phone, address, email FROM customers WHERE id = 1");
    const edit = (creditLimit) => call("PUT", "/fico/customers/1", { creditLimit, paymentTerms: c.payment_terms, taxId: c.tax_id, phone: c.phone, address: c.address, email: c.email });
    await edit(1);
    const r = await call("POST", "/sd/orders", { customerId: 1, lines: [{ materialId: mat.id, qty: 1, unitPrice: 10 }] });
    await edit(0);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.salesOrder.overCredit, true);
    assert.equal(r.body.salesOrder.approval_status, "pending");
  });

  it("bKash receipt books the fee to 5950 and the rest to 1150", async () => {
    const { body } = await call("POST", "/fico/ar-invoices", { customerId: 1, invoiceDate: "2026-03-01", amount: 1000, tax: 0, description: "mfs" });
    const r = await call("POST", `/fico/ar-invoices/${body.invoice.id}/receive`, { accountCode: "1150", fee: 18.5 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const lines = all(
      `SELECT a.code, l.debit_cents d, l.credit_cents c FROM journal_lines l JOIN journal_headers h ON h.id = l.header_id JOIN gl_accounts a ON a.id = l.account_id WHERE h.doc_number = ? ORDER BY a.code`,
      [r.body.journal]
    ).map((x) => ({ ...x }));
    assert.deepEqual(lines, [
      { code: "1150", d: 98150, c: 0 },
      { code: "1200", d: 0, c: 100000 },
      { code: "5950", d: 1850, c: 0 },
    ]);
    assert.equal((await call("POST", `/fico/ar-invoices/${body.invoice.id}/receive`, { accountCode: "2000" })).status, 400);
  });

  it("LC costs land in inventory: balanced, 1350 cleared, once only", async () => {
    const po = get("SELECT po_id FROM po_lines WHERE qty_received > 0 LIMIT 1");
    const lc = await call("POST", "/mm/lcs", { poId: po.po_id, bank: "DBBL" });
    assert.equal(lc.status, 201, JSON.stringify(lc.body));
    const id = lc.body.lc.id;
    await call("POST", `/mm/lcs/${id}/costs`, { costType: "Customs duty (CD/RD/SD)", amount: 5000, date: "2026-03-05" });
    await call("POST", `/mm/lcs/${id}/costs`, { costType: "C&F agent", amount: 1234.56, date: "2026-03-05" });
    const r = tx((db) => allocateLc(db, id, 1));
    assert.ok(journalBalanced(r.journal));
    const lcAcct = get(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents),0) n FROM journal_lines l JOIN gl_accounts a ON a.id = l.account_id WHERE a.code = '1350'`).n;
    assert.equal(lcAcct, 0);
    assert.throws(() => tx((db) => allocateLc(db, id, 1)), /already allocated/);
  });

  it("payroll: PF both sides, tax, net; once per month", async () => {
    const e = await call("POST", "/hr/employees", { name: "Test Staff", joinDate: "2026-01-01", basic: 20000, houseRent: 10000, medical: 1500, conveyance: 1000, pfPct: 10, monthlyTax: 500 });
    assert.equal(e.status, 201, JSON.stringify(e.body));
    const r = await call("POST", "/hr/payroll-runs", { period: "2026-03", kind: "salary", payDate: "2026-03-31" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(journalBalanced(r.body.journal));
    const slip = get("SELECT * FROM payslips WHERE employee_id = ?", [e.body.employee.id]);
    assert.deepEqual([slip.gross_cents, slip.pf_employee_cents, slip.tax_cents, slip.net_cents], [3250000, 200000, 50000, 3000000]);
    assert.equal((await call("POST", "/hr/payroll-runs", { period: "2026-03", kind: "salary" })).status, 400);
  });

  it("login locks after 5 failures for 15 minutes", () => {
    const k = "lock@test";
    for (let i = 0; i < 4; i++) recordLoginFailure(k, 0);
    assert.equal(loginLocked(k, 0), 0);
    recordLoginFailure(k, 0);
    assert.equal(loginLocked(k, 0), 15);
    assert.equal(loginLocked(k, 15 * 60 * 1000 + 1), 0);
    clearLoginFailures(k);
  });

  it("bumping token_version kills old tokens", () => {
    const token = signToken({ id: 1, email: "x" });
    const check = () => {
      let status = 200;
      authRequired({ headers: { authorization: `Bearer ${token}` } }, { status: (s) => ((status = s), { json: () => {} }) }, () => {});
      return status;
    };
    assert.equal(check(), 200);
    run("UPDATE users SET token_version = token_version + 1 WHERE id = 1");
    assert.equal(check(), 401);
  });
});

describe("financial statements and year-end (last: locks FY 2025-26)", () => {
  it("balance sheet balances and cash flow reconciles", () => {
    assert.ok(balanceSheet().balanced);
    const cf = cashFlow("2025-07-01", "2026-12-31");
    const sum = cf.sections.reduce((s, x) => s + cents(x.total), 0);
    assert.equal(sum, cents(cf.netChange));
    assert.equal(cents(cf.closing) - cents(cf.opening), cents(cf.netChange));
  });

  it("year-end close zeroes the P&L into 3100, once", () => {
    tx((db) => closeYear(db, "2026-06-30", 1));
    const pl = balancesBetween("2025-07-01", "2026-06-30").filter((r) => (r.type === "revenue" || r.type === "expense") && r.dr !== 0);
    assert.deepEqual(pl, []);
    assert.ok(balanceSheet("2026-06-30").balanced);
    assert.throws(() => tx((db) => closeYear(db, "2026-06-30", 1)), /already closed/);
    assert.throws(() => tx((db) => closeYear(db, "2026-12-31", 1)), /30 June/);
  });
});
