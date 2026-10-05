import { Router } from "express";
import { z } from "zod";
import { all, get, run, tx, cents, money, today, nextNumber } from "../db.js";
import { audit } from "../audit.js";
import { requirePermission } from "../auth.js";
import { postJournal, cashAccount, cashAccounts, nonZero } from "../posting.js";
import { balancesBetween } from "../dashboard.js";
import { customerExposure } from "./sd.js";

export const ficoRouter = Router();

const fail = (message) => Object.assign(new Error(message), { status: 400 });

function serializeInvoice(i) {
  return {
    ...i,
    amount: money(i.amount_cents),
    tax: money(i.tax_cents),
    settled: money(i.settled_cents),
    outstanding: money(i.amount_cents - i.settled_cents),
  };
}

/** Validates a requested settlement (Taka) against what is still owed; defaults to the full balance. */
function settlementCents(inv, requested) {
  const due = inv.amount_cents - inv.settled_cents;
  const amt = requested == null ? due : cents(requested);
  if (!(amt > 0) || amt > due) throw fail(`Amount must be more than 0 and at most ${money(due)}`);
  return amt;
}

function settle(table, inv, amountCents) {
  const settled = inv.settled_cents + amountCents;
  run(`UPDATE ${table} SET settled_cents = ?, status = ? WHERE id = ?`, [settled, settled >= inv.amount_cents ? "paid" : "partial", inv.id]);
}

function serializeJournal(h) {
  const lines = all(
    `SELECT l.*, a.code AS account_code, a.name AS account_name
     FROM journal_lines l JOIN gl_accounts a ON a.id = l.account_id
     WHERE l.header_id = ? ORDER BY l.line_no`,
    [h.id]
  ).map((l) => ({
    ...l,
    debit: money(l.debit_cents),
    credit: money(l.credit_cents),
  }));
  return {
    ...h,
    debit: lines.reduce((s, l) => s + l.debit, 0),
    credit: lines.reduce((s, l) => s + l.credit, 0),
    lines,
  };
}

ficoRouter.get("/accounts", requirePermission("fico.gl.read"), (_req, res) => {
  const accounts = all(
    `SELECT a.*,
            COALESCE(SUM(l.debit_cents), 0) AS debit_cents,
            COALESCE(SUM(l.credit_cents), 0) AS credit_cents
     FROM gl_accounts a
     LEFT JOIN journal_lines l ON l.account_id = a.id
     LEFT JOIN journal_headers h ON h.id = l.header_id AND h.status = 'posted'
     GROUP BY a.id
     ORDER BY a.code`
  ).map((a) => {
    const natural = ["asset", "expense"].includes(a.type) ? a.debit_cents - a.credit_cents : a.credit_cents - a.debit_cents;
    const balance = a.is_contra ? -natural : natural;
    return { ...a, debit: money(a.debit_cents), credit: money(a.credit_cents), balance: money(balance) };
  });
  res.json({ accounts });
});

ficoRouter.get("/journals", requirePermission("fico.gl.read"), (req, res) => {
  const rows = all("SELECT * FROM journal_headers ORDER BY id DESC LIMIT 200");
  res.json({ journals: rows.map(serializeJournal) });
});

ficoRouter.get("/journals/:id", requirePermission("fico.gl.read"), (req, res) => {
  const h = get("SELECT * FROM journal_headers WHERE id = ?", [req.params.id]);
  if (!h) return res.status(404).json({ error: "Journal not found" });
  res.json({ journal: serializeJournal(h) });
});

ficoRouter.post("/journals", requirePermission("fico.gl.write"), (req, res) => {
  const parsed = z
    .object({
      date: z.string().min(8),
      postingDate: z.string().optional(),
      description: z.string().min(1),
      lines: z
        .array(
          z.object({
            accountCode: z.string(),
            debit: z.number().nonnegative().default(0),
            credit: z.number().nonnegative().default(0),
            text: z.string().optional(),
          })
        )
        .min(2),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const journal = tx((db) => {
      const posted = postJournal(db, {
        date: parsed.data.date,
        postingDate: parsed.data.postingDate || parsed.data.date,
        sourceModule: "FICO",
        sourceId: "MANUAL",
        description: parsed.data.description,
        lines: parsed.data.lines,
        userId: req.user.id,
      });
      audit(req, { action: "POST", entityType: "journal", entityId: posted.docNumber, after: posted });
      return posted;
    });
    const h = get("SELECT * FROM journal_headers WHERE id = ?", [journal.id]);
    res.status(201).json({ journal: serializeJournal(h) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

ficoRouter.get("/trial-balance", requirePermission("fico.gl.read"), (_req, res) => {
  const accounts = all(
    `SELECT a.code, a.name, a.type, a.is_contra,
            COALESCE(SUM(l.debit_cents), 0) AS debit_cents,
            COALESCE(SUM(l.credit_cents), 0) AS credit_cents
     FROM gl_accounts a
     LEFT JOIN journal_lines l ON l.account_id = a.id
     LEFT JOIN journal_headers h ON h.id = l.header_id AND h.status = 'posted'
     GROUP BY a.id
     ORDER BY a.code`
  ).map((a) => {
    const natural = ["asset", "expense"].includes(a.type) ? a.debit_cents - a.credit_cents : a.credit_cents - a.debit_cents;
    const balance = a.is_contra ? -natural : natural;
    return {
      code: a.code,
      name: a.name,
      type: a.type,
      debit: balance >= 0 && ["asset", "expense"].includes(a.type) ? money(Math.abs(balance)) : !["asset", "expense"].includes(a.type) && balance < 0 ? money(Math.abs(balance)) : 0,
      credit: ["liability", "equity", "revenue"].includes(a.type) && balance >= 0 ? money(Math.abs(balance)) : ["asset", "expense"].includes(a.type) && balance < 0 ? money(Math.abs(balance)) : 0,
      balance: money(balance),
    };
  });

  // Present as TB: debit column for debit balances, credit for credit balances
  const rows = all(
    `SELECT a.code, a.name, a.type, a.is_contra,
            COALESCE(SUM(l.debit_cents), 0) AS debit_cents,
            COALESCE(SUM(l.credit_cents), 0) AS credit_cents
     FROM gl_accounts a
     LEFT JOIN journal_lines l ON l.account_id = a.id
     LEFT JOIN journal_headers h ON h.id = l.header_id AND h.status = 'posted'
     GROUP BY a.id
     ORDER BY a.code`
  ).map((a) => {
    let debitBal = a.debit_cents - a.credit_cents;
    if (a.is_contra) debitBal = -debitBal;
    const tbDebit = debitBal > 0 ? money(debitBal) : 0;
    const tbCredit = debitBal < 0 ? money(-debitBal) : 0;
    return { code: a.code, name: a.name, type: a.type, debit: tbDebit, credit: tbCredit };
  });
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  res.json({
    rows,
    totalDebit: Math.round(totalDebit * 100) / 100,
    totalCredit: Math.round(totalCredit * 100) / 100,
    balanced: Math.round(totalDebit * 100) === Math.round(totalCredit * 100),
  });
});

ficoRouter.get("/vendors", requirePermission("fico.ap.read", "mm.po.read"), (_req, res) => {
  res.json({ vendors: all("SELECT * FROM vendors ORDER BY code") });
});

ficoRouter.post("/vendors", requirePermission("fico.ap.write", "mm.po.write"), (req, res) => {
  const parsed = z.object({ name: z.string().min(1), email: z.string().optional(), taxId: z.string().optional(), paymentTerms: z.number().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Name is required" });
  const code = nextNumber("VENDOR");
  const r = run(
    "INSERT INTO vendors (code, name, email, tax_id, payment_terms) VALUES (?, ?, ?, ?, ?)",
    [code, parsed.data.name, parsed.data.email || "", parsed.data.taxId || "", parsed.data.paymentTerms || 30]
  );
  const vendor = get("SELECT * FROM vendors WHERE id = ?", [r.lastInsertRowid]);
  audit(req, { action: "CREATE", entityType: "vendor", entityId: code, after: vendor });
  res.status(201).json({ vendor });
});

ficoRouter.get("/customers", requirePermission("fico.ar.read", "sd.orders.read"), (_req, res) => {
  const customers = all("SELECT * FROM customers ORDER BY code").map((c) => ({
    ...c,
    creditLimit: money(c.credit_limit_cents),
    exposure: money(customerExposure(c.id)),
  }));
  res.json({ customers });
});

ficoRouter.put("/customers/:id", requirePermission("fico.ar.write"), (req, res) => {
  const parsed = z
    .object({
      creditLimit: z.number().nonnegative(),
      paymentTerms: z.number().int().nonnegative(),
      taxId: z.string().default(""),
      phone: z.string().default(""),
      address: z.string().default(""),
      email: z.string().default(""),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const before = get("SELECT * FROM customers WHERE id = ?", [req.params.id]);
  if (!before) return res.status(404).json({ error: "Customer not found" });
  const d = parsed.data;
  run("UPDATE customers SET credit_limit_cents = ?, payment_terms = ?, tax_id = ?, phone = ?, address = ?, email = ? WHERE id = ?", [
    cents(d.creditLimit),
    d.paymentTerms,
    d.taxId,
    d.phone,
    d.address,
    d.email,
    before.id,
  ]);
  audit(req, { action: "UPDATE", entityType: "customer", entityId: before.code, before, after: d });
  res.json({ ok: true });
});

ficoRouter.post("/customers", requirePermission("fico.ar.write"), (req, res) => {
  const parsed = z.object({ name: z.string().min(1), email: z.string().optional(), taxId: z.string().optional(), paymentTerms: z.number().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Name is required" });
  const code = nextNumber("CUSTOMER");
  const r = run(
    "INSERT INTO customers (code, name, email, tax_id, payment_terms) VALUES (?, ?, ?, ?, ?)",
    [code, parsed.data.name, parsed.data.email || "", parsed.data.taxId || "", parsed.data.paymentTerms || 30]
  );
  const customer = get("SELECT * FROM customers WHERE id = ?", [r.lastInsertRowid]);
  audit(req, { action: "CREATE", entityType: "customer", entityId: code, after: customer });
  res.status(201).json({ customer });
});

ficoRouter.get("/ap-invoices", requirePermission("fico.ap.read"), (_req, res) => {
  const invoices = all(
    `SELECT i.*, v.code AS vendor_code, v.name AS vendor_name, h.doc_number AS journal_no
     FROM ap_invoices i
     JOIN vendors v ON v.id = i.vendor_id
     LEFT JOIN journal_headers h ON h.id = i.journal_id
     ORDER BY i.id DESC`
  ).map(serializeInvoice);
  res.json({ invoices });
});

ficoRouter.post("/ap-invoices", requirePermission("fico.ap.write"), (req, res) => {
  const parsed = z
    .object({
      vendorId: z.number(),
      invoiceDate: z.string(),
      dueDate: z.string().optional(),
      amount: z.number().positive(),
      tax: z.number().nonnegative().default(0),
      description: z.string().min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const vendor = get("SELECT * FROM vendors WHERE id = ?", [parsed.data.vendorId]);
  if (!vendor) return res.status(400).json({ error: "Vendor not found" });
  try {
    const invoice = tx((db) => {
      const no = nextNumber("AP_INV");
      const net = parsed.data.amount - parsed.data.tax;
      const posted = postJournal(db, {
        date: parsed.data.invoiceDate,
        postingDate: parsed.data.invoiceDate,
        sourceModule: "FICO",
        sourceId: no,
        description: parsed.data.description,
        userId: req.user.id,
        lines: [
          { accountCode: "5900", debit: net, text: parsed.data.description },
          { accountCode: "2300", debit: parsed.data.tax, text: "Input VAT 15% (NBR)" },
          { accountCode: "2000", credit: parsed.data.amount, text: `AP ${vendor.name}` },
        ].filter((l) => (l.debit || 0) + (l.credit || 0) > 0),
      });
      const due =
        parsed.data.dueDate ||
        new Date(new Date(parsed.data.invoiceDate).getTime() + vendor.payment_terms * 86400000).toISOString().slice(0, 10);
      const r = run(
        `INSERT INTO ap_invoices (invoice_no, vendor_id, invoice_date, due_date, amount_cents, tax_cents, description, status, journal_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        [no, vendor.id, parsed.data.invoiceDate, due, cents(parsed.data.amount), cents(parsed.data.tax), parsed.data.description, posted.id, req.user.id]
      );
      audit(req, { action: "CREATE", entityType: "ap_invoice", entityId: no, after: { journal: posted.docNumber } });
      return get("SELECT * FROM ap_invoices WHERE id = ?", [r.lastInsertRowid]);
    });
    res.status(201).json({ invoice: { ...invoice, amount: money(invoice.amount_cents), tax: money(invoice.tax_cents) } });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

ficoRouter.post("/ap-invoices/:id/pay", requirePermission("fico.ap.write"), (req, res) => {
  const parsed = z
    .object({
      amount: z.number().positive().optional(),
      tds: z.number().nonnegative().default(0),
      date: z.string().optional(),
      accountCode: z.string().default("1100"),
      fee: z.number().nonnegative().default(0),
    })
    .safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const inv = get("SELECT * FROM ap_invoices WHERE id = ?", [req.params.id]);
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  try {
    const payment = tx((db) => {
      // amount = AP cleared; tds = part withheld for NBR, bank pays the rest
      const amt = settlementCents(inv, parsed.data.amount);
      const tds = cents(parsed.data.tds);
      if (tds >= amt) throw fail("TDS must be less than the payment amount");
      const account = cashAccount(parsed.data.accountCode);
      const fee = cents(parsed.data.fee);
      const date = parsed.data.date || today();
      const no = nextNumber("AP_PAY");
      const posted = postJournal(db, {
        date,
        postingDate: date,
        sourceModule: "FICO",
        sourceId: no,
        description: `Payment ${inv.invoice_no}`,
        userId: req.user.id,
        lines: nonZero([
          { accountCode: "2000", debit: money(amt), text: `Pay ${inv.invoice_no}` },
          { accountCode: "5950", debit: money(fee), text: "Bank / MFS charge" },
          { accountCode: account, credit: money(amt - tds + fee), text: `Payment ${inv.invoice_no}` },
          { accountCode: "2500", credit: money(tds), text: `TDS withheld ${inv.invoice_no}` },
        ]),
      });
      run(
        `INSERT INTO ap_payments (payment_no, vendor_id, invoice_id, payment_date, amount_cents, tds_cents, journal_id, created_by, account_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [no, inv.vendor_id, inv.id, date, amt, tds, posted.id, req.user.id, account]
      );
      settle("ap_invoices", inv, amt);
      audit(req, { action: "PAY", entityType: "ap_invoice", entityId: inv.invoice_no, after: { payment: no, amount: money(amt), tds: money(tds), journal: posted.docNumber } });
      return { paymentNo: no, journal: posted.docNumber };
    });
    res.json(payment);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

ficoRouter.get("/ar-invoices", requirePermission("fico.ar.read"), (_req, res) => {
  const invoices = all(
    `SELECT i.*, c.code AS customer_code, c.name AS customer_name, h.doc_number AS journal_no
     FROM ar_invoices i
     JOIN customers c ON c.id = i.customer_id
     LEFT JOIN journal_headers h ON h.id = i.journal_id
     ORDER BY i.id DESC`
  ).map(serializeInvoice);
  res.json({ invoices });
});

ficoRouter.post("/ar-invoices", requirePermission("fico.ar.write"), (req, res) => {
  const parsed = z
    .object({
      customerId: z.number(),
      invoiceDate: z.string(),
      dueDate: z.string().optional(),
      amount: z.number().positive(),
      tax: z.number().nonnegative().default(0),
      description: z.string().min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const customer = get("SELECT * FROM customers WHERE id = ?", [parsed.data.customerId]);
  if (!customer) return res.status(400).json({ error: "Customer not found" });
  try {
    const invoice = tx((db) => {
      const no = nextNumber("AR_INV");
      const net = parsed.data.amount - parsed.data.tax;
      const posted = postJournal(db, {
        date: parsed.data.invoiceDate,
        postingDate: parsed.data.invoiceDate,
        sourceModule: "FICO",
        sourceId: no,
        description: parsed.data.description,
        userId: req.user.id,
        lines: [
          { accountCode: "1200", debit: parsed.data.amount, text: `AR ${customer.name}` },
          { accountCode: "4000", credit: net, text: parsed.data.description },
          { accountCode: "2300", credit: parsed.data.tax, text: "Output VAT 15% (NBR)" },
        ].filter((l) => (l.debit || 0) + (l.credit || 0) > 0),
      });
      const due =
        parsed.data.dueDate ||
        new Date(new Date(parsed.data.invoiceDate).getTime() + customer.payment_terms * 86400000).toISOString().slice(0, 10);
      const r = run(
        `INSERT INTO ar_invoices (invoice_no, customer_id, invoice_date, due_date, amount_cents, tax_cents, description, status, journal_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        [no, customer.id, parsed.data.invoiceDate, due, cents(parsed.data.amount), cents(parsed.data.tax), parsed.data.description, posted.id, req.user.id]
      );
      audit(req, { action: "CREATE", entityType: "ar_invoice", entityId: no, after: { journal: posted.docNumber } });
      return get("SELECT * FROM ar_invoices WHERE id = ?", [r.lastInsertRowid]);
    });
    res.status(201).json({ invoice: { ...invoice, amount: money(invoice.amount_cents), tax: money(invoice.tax_cents) } });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

ficoRouter.get("/cash-accounts", (_req, res) => res.json({ accounts: cashAccounts() }));

ficoRouter.post("/ar-invoices/:id/receive", requirePermission("fico.ar.write"), (req, res) => {
  const parsed = z
    .object({ amount: z.number().positive().optional(), date: z.string().optional(), accountCode: z.string().default("1100"), fee: z.number().nonnegative().default(0) })
    .safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const inv = get("SELECT * FROM ar_invoices WHERE id = ?", [req.params.id]);
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  try {
    const receipt = tx((db) => {
      const amt = settlementCents(inv, parsed.data.amount);
      const account = cashAccount(parsed.data.accountCode);
      const fee = cents(parsed.data.fee);
      if (fee >= amt) throw fail("Charge must be less than the amount received");
      const date = parsed.data.date || today();
      const no = nextNumber("AR_RCT");
      const posted = postJournal(db, {
        date,
        postingDate: date,
        sourceModule: "FICO",
        sourceId: no,
        description: `Receipt ${inv.invoice_no}`,
        userId: req.user.id,
        lines: nonZero([
          { accountCode: account, debit: money(amt - fee), text: `Receipt ${inv.invoice_no}` },
          { accountCode: "5950", debit: money(fee), text: "Bank / MFS charge" },
          { accountCode: "1200", credit: money(amt), text: `Clear ${inv.invoice_no}` },
        ]),
      });
      const r = run(
        `INSERT INTO ar_receipts (receipt_no, customer_id, invoice_id, receipt_date, amount_cents, journal_id, created_by, account_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [no, inv.customer_id, inv.id, date, amt, posted.id, req.user.id, account]
      );
      settle("ar_invoices", inv, amt);
      audit(req, { action: "RECEIVE", entityType: "ar_invoice", entityId: inv.invoice_no, after: { receipt: no, amount: money(amt), journal: posted.docNumber } });
      return { receiptNo: no, receiptId: Number(r.lastInsertRowid), journal: posted.docNumber };
    });
    res.json(receipt);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

/** AR credit note: Dr Revenue + Output VAT, Cr AR. AP debit note: Dr AP, Cr Expense + Input VAT. VAT splits pro rata to the invoice. */
/**
 * With `stock`, the note is a goods return: sales return puts stock back (Dr 1300 / Cr 5000 at standard),
 * purchase return takes it out (Cr 1300 at standard, price difference to 5900).
 */
function postInvoiceNote(req, kind, inv, { amount, reason, date, stock }) {
  return tx((db) => {
    const amt = settlementCents(inv, amount);
    const tax = Math.round((amt * inv.tax_cents) / inv.amount_cents);
    const d = date || today();
    const no = nextNumber(kind === "credit" ? "CREDIT_NOTE" : "DEBIT_NOTE");
    let material = null;
    let invRow = null;
    let stdValue = 0;
    if (stock) {
      material = get("SELECT * FROM materials WHERE id = ?", [stock.materialId]);
      if (!material) throw fail("Material not found");
      if (!get("SELECT id FROM storage_locations WHERE id = ?", [stock.storageLocationId])) throw fail("Storage location not found");
      invRow = get("SELECT * FROM inventory WHERE material_id = ? AND storage_location_id = ?", [material.id, stock.storageLocationId]);
      if (kind === "debit" && (!invRow || invRow.qty_on_hand < stock.qty)) throw fail(`Not enough ${material.sku} in that location to return`);
      stdValue = Math.round(stock.qty * material.std_price_cents);
    }
    const priceDiff = amt - tax - stdValue;
    const lines =
      kind === "credit"
        ? [
            { accountCode: "4000", debit: money(amt - tax), text: reason },
            { accountCode: "2300", debit: money(tax), text: "Output VAT reversal (NBR)" },
            { accountCode: "1200", credit: money(amt), text: `Credit note ${inv.invoice_no}` },
            { accountCode: "1300", debit: money(stdValue), text: material ? `Returned ${material.sku} × ${stock.qty}` : "" },
            { accountCode: "5000", credit: money(stdValue), text: "COGS reversal" },
          ]
        : [
            { accountCode: "2000", debit: money(amt), text: `Debit note ${inv.invoice_no}` },
            { accountCode: "2300", credit: money(tax), text: "Input VAT reversal (NBR)" },
            { accountCode: "1300", credit: money(stdValue), text: material ? `Returned ${material.sku} × ${stock.qty}` : "" },
            priceDiff >= 0 ? { accountCode: "5900", credit: money(priceDiff), text: reason } : { accountCode: "5900", debit: money(-priceDiff), text: `${reason} (price difference)` },
          ];
    const posted = postJournal(db, {
      date: d,
      postingDate: d,
      sourceModule: "FICO",
      sourceId: no,
      description: `${kind === "credit" ? "Credit" : "Debit"} note ${no} — ${inv.invoice_no}: ${reason}`,
      userId: req.user.id,
      lines: nonZero(lines),
    });
    if (stock) {
      const qtyDelta = kind === "credit" ? stock.qty : -stock.qty;
      if (invRow) run("UPDATE inventory SET qty_on_hand = qty_on_hand + ? WHERE id = ?", [qtyDelta, invRow.id]);
      else run("INSERT INTO inventory (material_id, storage_location_id, qty_on_hand) VALUES (?, ?, ?)", [material.id, stock.storageLocationId, qtyDelta]);
      run(
        `INSERT INTO goods_movements (movement_no, movement_type, material_id, storage_location_id, qty, unit_cost_cents, ref_type, ref_id, journal_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nextNumber(kind === "credit" ? "GR" : "GI"),
          kind === "credit" ? "GR" : "GI",
          material.id,
          stock.storageLocationId,
          stock.qty,
          material.std_price_cents,
          kind === "credit" ? "SRET" : "PRET",
          no,
          posted.id,
          req.user.id,
        ]
      );
    }
    run(
      `INSERT INTO invoice_notes (note_no, kind, invoice_id, note_date, amount_cents, tax_cents, reason, journal_id, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [no, kind, inv.id, d, amt, tax, reason, posted.id, req.user.id]
    );
    settle(kind === "credit" ? "ar_invoices" : "ap_invoices", inv, amt);
    audit(req, { action: kind === "credit" ? "CREDIT_NOTE" : "DEBIT_NOTE", entityType: "invoice_note", entityId: no, after: { invoice: inv.invoice_no, amount: money(amt), journal: posted.docNumber } });
    return { noteNo: no, journal: posted.docNumber, amount: money(amt), tax: money(tax) };
  });
}

const noteSchema = z.object({
  amount: z.number().positive(),
  reason: z.string().min(1),
  date: z.string().optional(),
  stock: z.object({ materialId: z.number(), qty: z.number().positive(), storageLocationId: z.number() }).optional(),
});

for (const [kind, table, path, perm] of [
  ["credit", "ar_invoices", "/ar-invoices/:id/credit-note", "fico.ar.write"],
  ["debit", "ap_invoices", "/ap-invoices/:id/debit-note", "fico.ap.write"],
]) {
  ficoRouter.post(path, requirePermission(perm), (req, res) => {
    const parsed = noteSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const inv = get(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
    if (!inv) return res.status(404).json({ error: "Invoice not found" });
    try {
      res.status(201).json(postInvoiceNote(req, kind, inv, parsed.data));
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });
}

ficoRouter.get("/invoice-notes", requirePermission("fico.ar.read", "fico.ap.read"), (_req, res) => {
  const notes = all(
    `SELECT n.*, COALESCE(ar.invoice_no, ap.invoice_no) AS invoice_no, COALESCE(c.name, v.name) AS partner_name
     FROM invoice_notes n
     LEFT JOIN ar_invoices ar ON n.kind = 'credit' AND ar.id = n.invoice_id
     LEFT JOIN customers c ON c.id = ar.customer_id
     LEFT JOIN ap_invoices ap ON n.kind = 'debit' AND ap.id = n.invoice_id
     LEFT JOIN vendors v ON v.id = ap.vendor_id
     ORDER BY n.id DESC`
  ).map((n) => ({ ...n, amount: money(n.amount_cents), tax: money(n.tax_cents) }));
  res.json({ notes });
});

ficoRouter.get("/assets", requirePermission("fico.assets.read"), (_req, res) => {
  const assets = all("SELECT * FROM fixed_assets ORDER BY id DESC").map((a) => ({
    ...a,
    acquisition: money(a.acquisition_cents),
    accumDepr: money(a.accum_depr_cents),
    netBook: money(a.acquisition_cents - a.accum_depr_cents),
  }));
  res.json({ assets });
});

ficoRouter.post("/assets", requirePermission("fico.assets.write"), (req, res) => {
  const parsed = z
    .object({
      name: z.string().min(1),
      assetClass: z.string().default("equipment"),
      acquisitionDate: z.string(),
      acquisition: z.number().positive(),
      usefulLifeMonths: z.number().int().positive().default(60),
      payFromBank: z.boolean().default(true),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const asset = tx((db) => {
      const code = nextNumber("ASSET");
      const posted = postJournal(db, {
        date: parsed.data.acquisitionDate,
        postingDate: parsed.data.acquisitionDate,
        sourceModule: "FICO",
        sourceId: code,
        description: `Acquire ${parsed.data.name}`,
        userId: req.user.id,
        lines: [
          { accountCode: "1500", debit: parsed.data.acquisition, text: parsed.data.name },
          {
            accountCode: parsed.data.payFromBank ? "1100" : "2000",
            credit: parsed.data.acquisition,
            text: parsed.data.payFromBank ? "Bank" : "AP",
          },
        ],
      });
      const r = run(
        `INSERT INTO fixed_assets (code, name, asset_class, acquisition_date, acquisition_cents, useful_life_months, journal_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [code, parsed.data.name, parsed.data.assetClass, parsed.data.acquisitionDate, cents(parsed.data.acquisition), parsed.data.usefulLifeMonths, posted.id, req.user.id]
      );
      audit(req, { action: "CREATE", entityType: "asset", entityId: code, after: { journal: posted.docNumber } });
      return get("SELECT * FROM fixed_assets WHERE id = ?", [r.lastInsertRowid]);
    });
    res.status(201).json({ asset: { ...asset, acquisition: money(asset.acquisition_cents) } });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

/** Straight-line depreciation for one month (YYYY-MM), posted on the last day of that month. Runs once per month. */
export function runDepreciation(db, period, userId) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw fail("Period must be YYYY-MM");
  if (get("SELECT period FROM depreciation_runs WHERE period = ?", [period])) throw fail(`Depreciation for ${period} was already posted`);
  const [y, m] = period.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  if (end > today()) throw fail(`${period} has not ended yet — run it on or after ${end}`);
  const items = all("SELECT * FROM fixed_assets WHERE status = 'active' AND acquisition_date <= ?", [end])
    .map((a) => ({ a, amount: Math.min(Math.round(a.acquisition_cents / a.useful_life_months), a.acquisition_cents - a.accum_depr_cents) }))
    .filter((x) => x.amount > 0);
  if (!items.length) throw fail("No assets to depreciate for this month");
  const total = items.reduce((s, x) => s + x.amount, 0);
  const posted = postJournal(db, {
    date: end,
    postingDate: end,
    sourceModule: "FICO",
    sourceId: `DEPR-${period}`,
    description: `Depreciation run ${period}`,
    userId,
    lines: [
      ...items.map((x) => ({ accountCode: "5300", debit: money(x.amount), text: `${x.a.code} ${x.a.name}` })),
      { accountCode: "1510", credit: money(total), text: "Accum. depreciation" },
    ],
  });
  for (const x of items) run("UPDATE fixed_assets SET accum_depr_cents = accum_depr_cents + ? WHERE id = ?", [x.amount, x.a.id]);
  run("INSERT INTO depreciation_runs (period, journal_id, amount_cents, run_by) VALUES (?,?,?,?)", [period, posted.id, total, userId]);
  return { period, journal: posted.docNumber, amount: money(total), assets: items.length };
}

ficoRouter.get("/depreciation-runs", requirePermission("fico.assets.read"), (_req, res) => {
  const runs = all(
    `SELECT r.*, h.doc_number AS journal_no FROM depreciation_runs r LEFT JOIN journal_headers h ON h.id = r.journal_id ORDER BY r.period DESC`
  ).map((r) => ({ ...r, amount: money(r.amount_cents) }));
  res.json({ runs });
});

/** Closes FY ending fyEnd (YYYY-06-30): zeroes revenue/expense into 3100 Retained earnings, locks the year's periods, opens next year's. */
export function closeYear(db, fyEnd, userId) {
  if (!/^\d{4}-06-30$/.test(fyEnd)) throw fail("Fiscal year end must be 30 June (YYYY-06-30)");
  if (fyEnd >= today()) throw fail("That fiscal year has not ended yet");
  if (get("SELECT fy_end FROM year_closes WHERE fy_end = ?", [fyEnd])) throw fail(`FY ending ${fyEnd} is already closed`);
  const y = Number(fyEnd.slice(0, 4));
  const fyStart = `${y - 1}-07-01`;
  const pl = balancesBetween(fyStart, fyEnd, { excludeClose: true }).filter((r) => (r.type === "revenue" || r.type === "expense") && r.dr !== 0);
  const profit = -pl.reduce((s, r) => s + r.dr, 0);
  const posted = postJournal(db, {
    date: fyEnd,
    postingDate: fyEnd,
    sourceModule: "YEAR_END",
    sourceId: `FY${y - 1}-${String(y).slice(2)}`,
    description: `Year-end close FY ${y - 1}–${String(y).slice(2)}`,
    userId,
    lines: nonZero([
      ...pl.map((r) => (r.dr > 0 ? { accountCode: r.code, credit: money(r.dr), text: "Close" } : { accountCode: r.code, debit: money(-r.dr), text: "Close" })),
      profit >= 0 ? { accountCode: "3100", credit: money(profit), text: "Profit for the year" } : { accountCode: "3100", debit: money(-profit), text: "Loss for the year" },
    ]),
  });
  run("UPDATE fiscal_periods SET status = 'closed' WHERE start_date >= ? AND end_date <= ?", [fyStart, fyEnd]);
  for (let m = 0; m < 12; m++) {
    const s = new Date(Date.UTC(y, 6 + m, 1));
    const e = new Date(Date.UTC(y, 7 + m, 0));
    const code = s.toISOString().slice(0, 7);
    if (!get("SELECT id FROM fiscal_periods WHERE code = ?", [code])) {
      run("INSERT INTO fiscal_periods (code, start_date, end_date, status) VALUES (?, ?, ?, 'open')", [code, s.toISOString().slice(0, 10), e.toISOString().slice(0, 10)]);
    }
  }
  run("INSERT INTO year_closes (fy_end, journal_id, profit_cents, closed_by) VALUES (?, ?, ?, ?)", [fyEnd, posted.id, profit, userId]);
  return { fyEnd, journal: posted.docNumber, profit: money(profit) };
}

ficoRouter.get("/year-closes", requirePermission("fico.gl.read"), (_req, res) => {
  const closes = all(
    "SELECT y.*, h.doc_number AS journal_no FROM year_closes y LEFT JOIN journal_headers h ON h.id = y.journal_id ORDER BY fy_end DESC"
  ).map((r) => ({ ...r, profit: money(r.profit_cents) }));
  res.json({ closes });
});

ficoRouter.post("/year-end-close", requirePermission("fico.gl.write"), (req, res) => {
  try {
    const result = tx((db) => closeYear(db, String(req.body?.fyEnd || ""), req.user.id));
    audit(req, { action: "YEAR_END_CLOSE", entityType: "fiscal_year", entityId: result.fyEnd, after: result });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

ficoRouter.post("/depreciation-runs", requirePermission("fico.assets.write"), (req, res) => {
  try {
    const result = tx((db) => runDepreciation(db, String(req.body?.period || ""), req.user.id));
    audit(req, { action: "DEPRECIATE", entityType: "depreciation_run", entityId: result.period, after: result });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});
