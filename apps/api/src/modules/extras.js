import { Router } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { all, get, run, tx, cents, money, today, nextNumber } from "../db.js";
import { snapshot, runBackup, backupStatus, setBackupDir } from "../backup.js";
import { loadQuote } from "./sd.js";
import { audit } from "../audit.js";
import { requirePermission } from "../auth.js";
import { postJournal, accountBalance, cashAccount } from "../posting.js";

export const extrasRouter = Router();

function approvalLimit() {
  const row = get("SELECT value FROM app_settings WHERE key = 'approval_limit_bdt'");
  return Number(row?.value || 50000);
}

function ageBucket(days) {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

extrasRouter.get("/cost-centers", requirePermission("dashboard.read"), (_req, res) => {
  res.json({ costCenters: all("SELECT * FROM cost_centers ORDER BY code") });
});

extrasRouter.get("/periods", requirePermission("fico.gl.read"), (_req, res) => {
  res.json({ periods: all("SELECT * FROM fiscal_periods ORDER BY start_date") });
});

extrasRouter.post("/periods/:id/lock", requirePermission("fico.gl.write"), (req, res) => {
  const p = get("SELECT * FROM fiscal_periods WHERE id = ?", [req.params.id]);
  if (!p) return res.status(404).json({ error: "Period not found" });
  run("UPDATE fiscal_periods SET status = 'closed' WHERE id = ?", [p.id]);
  audit(req, { action: "LOCK", entityType: "fiscal_period", entityId: p.code });
  res.json({ ok: true, code: p.code, status: "closed" });
});

extrasRouter.post("/periods/:id/unlock", requirePermission("fico.gl.write"), (req, res) => {
  const p = get("SELECT * FROM fiscal_periods WHERE id = ?", [req.params.id]);
  if (!p) return res.status(404).json({ error: "Period not found" });
  run("UPDATE fiscal_periods SET status = 'open' WHERE id = ?", [p.id]);
  audit(req, { action: "UNLOCK", entityType: "fiscal_period", entityId: p.code });
  res.json({ ok: true, code: p.code, status: "open" });
});

extrasRouter.get("/aging/ar", requirePermission("fico.ar.read", "reports.read"), (_req, res) => {
  const asOf = today();
  const rows = all(
    `SELECT i.*, c.code AS partner_code, c.name AS partner_name
     FROM ar_invoices i JOIN customers c ON c.id = i.customer_id WHERE i.status IN ('open','partial')`
  ).map((i) => {
    const days = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(i.due_date)) / 86400000));
    return {
      ...i,
      amount: money(i.amount_cents - i.settled_cents),
      daysPastDue: days,
      bucket: ageBucket(days),
    };
  });
  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const r of rows) buckets[r.bucket] += r.amount;
  res.json({ asOf, rows, buckets, total: rows.reduce((s, r) => s + r.amount, 0) });
});

extrasRouter.get("/aging/ap", requirePermission("fico.ap.read", "reports.read"), (_req, res) => {
  const asOf = today();
  const rows = all(
    `SELECT i.*, v.code AS partner_code, v.name AS partner_name
     FROM ap_invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.status IN ('open','partial')`
  ).map((i) => {
    const days = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(i.due_date)) / 86400000));
    return { ...i, amount: money(i.amount_cents - i.settled_cents), daysPastDue: days, bucket: ageBucket(days) };
  });
  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const r of rows) buckets[r.bucket] += r.amount;
  res.json({ asOf, rows, buckets, total: rows.reduce((s, r) => s + r.amount, 0) });
});

extrasRouter.get("/ledger/customer/:id", requirePermission("fico.ar.read"), (req, res) => {
  const c = get("SELECT * FROM customers WHERE id = ?", [req.params.id]);
  if (!c) return res.status(404).json({ error: "Customer not found" });
  const invoices = all("SELECT * FROM ar_invoices WHERE customer_id = ? ORDER BY invoice_date, id", [c.id]).map((i) => ({
    ...i,
    amount: money(i.amount_cents),
    tax: money(i.tax_cents),
    outstanding: money(i.amount_cents - i.settled_cents),
  }));
  const receipts = all("SELECT * FROM ar_receipts WHERE customer_id = ? ORDER BY receipt_date, id", [c.id]).map((r) => ({
    ...r,
    amount: money(r.amount_cents),
  }));
  const open = invoices.reduce((s, i) => s + i.outstanding, 0);
  res.json({ customer: c, invoices, receipts, openBalance: open });
});

extrasRouter.get("/ledger/vendor/:id", requirePermission("fico.ap.read"), (req, res) => {
  const v = get("SELECT * FROM vendors WHERE id = ?", [req.params.id]);
  if (!v) return res.status(404).json({ error: "Vendor not found" });
  const invoices = all("SELECT * FROM ap_invoices WHERE vendor_id = ? ORDER BY invoice_date, id", [v.id]).map((i) => ({
    ...i,
    amount: money(i.amount_cents),
    tax: money(i.tax_cents),
    outstanding: money(i.amount_cents - i.settled_cents),
  }));
  const payments = all("SELECT * FROM ap_payments WHERE vendor_id = ? ORDER BY payment_date, id", [v.id]).map((p) => ({
    ...p,
    amount: money(p.amount_cents),
  }));
  const open = invoices.reduce((s, i) => s + i.outstanding, 0);
  res.json({ vendor: v, invoices, payments, openBalance: open });
});

extrasRouter.get("/vat-return", requirePermission("reports.read", "fico.gl.read"), (req, res) => {
  const from = req.query.from || "2025-07-01";
  const to = req.query.to || today();
  const lines = all(
    `SELECT h.doc_number, h.posting_date, h.source_module, h.description, l.debit_cents, l.credit_cents, l.text
     FROM journal_lines l
     JOIN journal_headers h ON h.id = l.header_id
     JOIN gl_accounts a ON a.id = l.account_id
     WHERE a.code = '2300' AND h.posting_date >= ? AND h.posting_date <= ?
     ORDER BY h.posting_date, h.id`,
    [from, to]
  ).map((l) => ({
    ...l,
    debit: money(l.debit_cents),
    credit: money(l.credit_cents),
  }));
  const inputVat = lines.reduce((s, l) => s + l.debit, 0);
  const outputVat = lines.reduce((s, l) => s + l.credit, 0);
  res.json({
    from,
    to,
    inputVat,
    outputVat,
    netPayable: Math.round((outputVat - inputVat) * 100) / 100,
    tdsWithheld: money(get("SELECT COALESCE(SUM(tds_cents),0) AS c FROM ap_payments WHERE payment_date BETWEEN ? AND ?", [from, to]).c),
    tdsPayable: money(accountBalance("2500")?.balance_cents || 0),
    lines,
  });
});

extrasRouter.get("/reorder", requirePermission("mm.inventory.read"), (_req, res) => {
  const rows = all(
    `SELECT m.*, COALESCE(SUM(i.qty_on_hand), 0) AS on_hand
     FROM materials m
     LEFT JOIN inventory i ON i.material_id = m.id
     GROUP BY m.id
     HAVING m.reorder_min > 0 AND on_hand < m.reorder_min
     ORDER BY (m.reorder_min - on_hand) DESC`
  ).map((r) => ({
    ...r,
    stdPrice: money(r.std_price_cents),
    shortfall: r.reorder_min - r.on_hand,
    suggestOrder: Math.max(0, r.reorder_max - r.on_hand),
  }));
  res.json({ alerts: rows });
});

extrasRouter.get("/cashbook", requirePermission("fico.gl.read"), (_req, res) => {
  const rows = all("SELECT * FROM cash_transactions ORDER BY id DESC LIMIT 200").map((r) => ({
    ...r,
    amount: money(r.amount_cents),
  }));
  res.json({ transactions: rows });
});

extrasRouter.post("/cashbook", requirePermission("fico.gl.write"), (req, res) => {
  const parsed = z
    .object({
      txnType: z.enum(["receipt", "payment", "transfer"]),
      accountCode: z.string(),
      amount: z.number().positive(),
      mode: z.string().default("cash"),
      counterparty: z.string().optional(),
      description: z.string().min(1),
      reference: z.string().optional(),
      txnDate: z.string().optional(),
      offsetAccount: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    cashAccount(parsed.data.accountCode);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const d = parsed.data.txnDate || today();
  const offset =
    parsed.data.offsetAccount ||
    (parsed.data.txnType === "receipt" ? "1200" : parsed.data.txnType === "payment" ? "2000" : parsed.data.accountCode === "1000" ? "1100" : "1000");
  try {
    const result = tx((db) => {
      const no = nextNumber("CASH");
      const amt = parsed.data.amount;
      const lines =
        parsed.data.txnType === "receipt"
          ? [
              { accountCode: parsed.data.accountCode, debit: amt, text: parsed.data.description },
              { accountCode: offset, credit: amt, text: parsed.data.counterparty || parsed.data.description },
            ]
          : parsed.data.txnType === "payment"
            ? [
                { accountCode: offset, debit: amt, text: parsed.data.description },
                { accountCode: parsed.data.accountCode, credit: amt, text: parsed.data.counterparty || "Bank/cash" },
              ]
            : [
                { accountCode: offset, debit: amt, text: "Transfer in" },
                { accountCode: parsed.data.accountCode, credit: amt, text: "Transfer out" },
              ];
      const posted = postJournal(db, {
        date: d,
        postingDate: d,
        sourceModule: "FICO",
        sourceId: no,
        description: parsed.data.description,
        lines,
        userId: req.user.id,
      });
      run(
        `INSERT INTO cash_transactions (doc_no, txn_date, txn_type, account_code, counterparty, amount_cents, mode, reference, description, journal_id, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          no,
          d,
          parsed.data.txnType,
          parsed.data.accountCode,
          parsed.data.counterparty || "",
          cents(amt),
          parsed.data.mode,
          parsed.data.reference || "",
          parsed.data.description,
          posted.id,
          req.user.id,
        ]
      );
      audit(req, { action: "CASH", entityType: "cash_txn", entityId: no, after: posted });
      return { docNo: no, journal: posted.docNumber };
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

extrasRouter.get("/approvals", requirePermission("dashboard.read"), (_req, res) => {
  res.json({
    approvals: all(
      `SELECT a.*, u.name AS requester_name FROM approval_requests a
       LEFT JOIN users u ON u.id = a.requested_by ORDER BY a.id DESC LIMIT 100`
    ).map((a) => ({ ...a, amount: money(a.amount_cents) })),
    limit: approvalLimit(),
  });
});

extrasRouter.post("/approvals/:id/decide", requirePermission("security.users.write", "fico.gl.write"), (req, res) => {
  const parsed = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "decision required" });
  const row = get("SELECT * FROM approval_requests WHERE id = ?", [req.params.id]);
  if (!row || row.status !== "pending") return res.status(400).json({ error: "Not a pending approval" });
  run("UPDATE approval_requests SET status = ?, decided_by = ?, decided_at = datetime('now'), note = ? WHERE id = ?", [
    parsed.data.decision,
    req.user.id,
    parsed.data.note || "",
    row.id,
  ]);
  if (row.entity_type === "purchase_order") {
    run("UPDATE purchase_orders SET approval_status = ? WHERE id = ?", [parsed.data.decision, row.entity_id]);
  }
  if (row.entity_type === "sales_order") {
    run("UPDATE sales_orders SET approval_status = ? WHERE id = ?", [parsed.data.decision, row.entity_id]);
  }
  audit(req, { action: parsed.data.decision.toUpperCase(), entityType: "approval", entityId: row.entity_no });
  res.json({ ok: true });
});

extrasRouter.get("/mrp", requirePermission("pp.orders.read", "mm.po.read"), (_req, res) => {
  const openSo = all(
    `SELECT l.material_id, m.sku, m.name, m.type, SUM(l.qty - l.qty_delivered) AS demand
     FROM so_lines l
     JOIN sales_orders s ON s.id = l.so_id
     JOIN materials m ON m.id = l.material_id
     WHERE s.status IN ('open','partial','delivered') AND s.approval_status != 'rejected'
     GROUP BY l.material_id`
  );
  const suggestions = [];
  for (const dem of openSo) {
    if (dem.type === "finished") {
      const bom = get("SELECT id FROM boms WHERE parent_material_id = ? AND status = 'active'", [dem.material_id]);
      const onHand = get("SELECT COALESCE(SUM(qty_on_hand),0) AS q FROM inventory WHERE material_id = ?", [dem.material_id])?.q || 0;
      const shortFg = Math.max(0, dem.demand - onHand);
      if (shortFg > 0) {
        suggestions.push({
          kind: "produce",
          materialId: dem.material_id,
          sku: dem.sku,
          name: dem.name,
          qty: shortFg,
          reason: `Open SO demand ${dem.demand}, stock ${onHand}`,
        });
      }
      if (bom) {
        const comps = all("SELECT * FROM bom_components WHERE bom_id = ?", [bom.id]);
        for (const c of comps) {
          const need = c.qty * (1 + c.scrap_pct / 100) * Math.max(dem.demand, shortFg || dem.demand);
          const mat = get("SELECT * FROM materials WHERE id = ?", [c.component_material_id]);
          const stock = get("SELECT COALESCE(SUM(qty_on_hand),0) AS q FROM inventory WHERE material_id = ?", [c.component_material_id])?.q || 0;
          const buy = Math.max(0, need - stock);
          if (buy > 0) {
            suggestions.push({
              kind: "purchase",
              materialId: mat.id,
              sku: mat.sku,
              name: mat.name,
              qty: Math.ceil(buy * 100) / 100,
              reason: `BOM for ${dem.sku}: need ${need.toFixed(2)}, stock ${stock}`,
            });
          }
        }
      }
    }
  }
  const alerts = all(
    `SELECT m.id AS materialId, m.sku, m.name, m.reorder_min, COALESCE(SUM(i.qty_on_hand),0) AS on_hand
     FROM materials m LEFT JOIN inventory i ON i.material_id = m.id
     GROUP BY m.id HAVING m.reorder_min > 0 AND on_hand < m.reorder_min`
  );
  for (const a of alerts) {
    if (!suggestions.find((s) => s.materialId === a.materialId && s.kind === "purchase")) {
      suggestions.push({
        kind: "purchase",
        materialId: a.materialId,
        sku: a.sku,
        name: a.name,
        qty: a.reorder_min - a.on_hand,
        reason: "Below reorder point",
      });
    }
  }
  res.json({ suggestions, generatedAt: new Date().toISOString() });
});

extrasRouter.get("/lots", requirePermission("mm.inventory.read"), (_req, res) => {
  res.json({
    lots: all(
      `SELECT l.*, m.sku, m.name AS material_name, s.code AS location_code
       FROM stock_lots l
       JOIN materials m ON m.id = l.material_id
       JOIN storage_locations s ON s.id = l.storage_location_id
       ORDER BY l.id DESC`
    ),
  });
});

extrasRouter.post("/lots", requirePermission("mm.inventory.post"), (req, res) => {
  const parsed = z
    .object({
      materialId: z.number(),
      storageLocationId: z.number(),
      qty: z.number().positive(),
      manufacturedOn: z.string().optional(),
      notes: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const no = nextNumber("LOT");
  const r = run(
    `INSERT INTO stock_lots (lot_no, material_id, storage_location_id, qty, manufactured_on, notes) VALUES (?,?,?,?,?,?)`,
    [no, parsed.data.materialId, parsed.data.storageLocationId, parsed.data.qty, parsed.data.manufacturedOn || today(), parsed.data.notes || ""]
  );
  res.status(201).json({ lot: get("SELECT * FROM stock_lots WHERE id = ?", [r.lastInsertRowid]) });
});

extrasRouter.post("/gate-passes", requirePermission("sd.deliver.write", "mm.inventory.post"), (req, res) => {
  const parsed = z
    .object({
      passType: z.enum(["in", "out"]).default("out"),
      refType: z.string().optional(),
      refId: z.string().optional(),
      vehicleNo: z.string().optional(),
      driverName: z.string().optional(),
      gate: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const no = nextNumber("GATE");
  const r = run(
    `INSERT INTO gate_passes (pass_no, pass_type, ref_type, ref_id, vehicle_no, driver_name, gate, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      no,
      parsed.data.passType,
      parsed.data.refType || null,
      parsed.data.refId || null,
      parsed.data.vehicleNo || "",
      parsed.data.driverName || "",
      parsed.data.gate || "Tejgaon Main",
      req.user.id,
    ]
  );
  res.status(201).json({ gatePass: get("SELECT * FROM gate_passes WHERE id = ?", [r.lastInsertRowid]) });
});

extrasRouter.get("/gate-passes", requirePermission("sd.orders.read", "mm.inventory.read"), (_req, res) => {
  res.json({ passes: all("SELECT * FROM gate_passes ORDER BY id DESC LIMIT 100") });
});

extrasRouter.get("/print/invoice/:id", requirePermission("fico.ar.read", "sd.orders.read"), (req, res) => {
  const inv = get(
    `SELECT i.*, c.code AS customer_code, c.name AS customer_name, c.tax_id AS customer_bin, c.address AS customer_address, c.email
     FROM ar_invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ?`,
    [req.params.id]
  );
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  const company = get("SELECT * FROM company_profile WHERE id = 1");
  res.json({
    type: "mushak",
    title: "Tax Invoice / Mushak",
    company,
    invoice: { ...inv, amount: money(inv.amount_cents), tax: money(inv.tax_cents), net: money(inv.amount_cents - inv.tax_cents) },
  });
});

extrasRouter.get("/print/challan/:id", requirePermission("sd.orders.read"), (req, res) => {
  const d = get(
    `SELECT d.*, s.so_number, c.name AS customer_name, c.address AS customer_address
     FROM deliveries d
     JOIN sales_orders s ON s.id = d.so_id
     JOIN customers c ON c.id = s.customer_id
     WHERE d.id = ?`,
    [req.params.id]
  );
  if (!d) return res.status(404).json({ error: "Delivery not found" });
  const lines = all(
    `SELECT dl.*, m.sku, m.name AS material_name, m.uom FROM delivery_lines dl
     JOIN materials m ON m.id = dl.material_id WHERE dl.delivery_id = ?`,
    [d.id]
  );
  const company = get("SELECT * FROM company_profile WHERE id = 1");
  res.json({ type: "challan", title: "Delivery Challan", company, delivery: d, lines });
});

extrasRouter.get("/print/receipt/:id", requirePermission("fico.ar.read"), (req, res) => {
  const r = get(
    `SELECT r.*, c.name AS customer_name FROM ar_receipts r JOIN customers c ON c.id = r.customer_id WHERE r.id = ?`,
    [req.params.id]
  );
  if (!r) return res.status(404).json({ error: "Receipt not found" });
  const company = get("SELECT * FROM company_profile WHERE id = 1");
  res.json({ type: "receipt", title: "Money Receipt", company, receipt: { ...r, amount: money(r.amount_cents) } });
});

/** Statement of account: invoices (debit) vs receipts and credit notes (credit) with running balance. */
extrasRouter.get("/print/statement/:id", requirePermission("fico.ar.read"), (req, res) => {
  const c = get("SELECT * FROM customers WHERE id = ?", [req.params.id]);
  if (!c) return res.status(404).json({ error: "Customer not found" });
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || "") ? req.query.from : "0000-01-01";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || "") ? req.query.to : today();
  const entries = all(
    `SELECT invoice_date AS d, invoice_no AS doc, description AS text, amount_cents AS dr, 0 AS cr FROM ar_invoices WHERE customer_id = ?1
     UNION ALL SELECT receipt_date, receipt_no, 'Payment received', 0, amount_cents FROM ar_receipts WHERE customer_id = ?1
     UNION ALL SELECT n.note_date, n.note_no, 'Credit note — ' || n.reason, 0, n.amount_cents FROM invoice_notes n
       JOIN ar_invoices i ON i.id = n.invoice_id WHERE n.kind = 'credit' AND i.customer_id = ?1
     ORDER BY 1, 2`,
    [c.id]
  );
  let balance = entries.filter((e) => e.d < from).reduce((s, e) => s + e.dr - e.cr, 0);
  const opening = balance;
  const lines = entries
    .filter((e) => e.d >= from && e.d <= to)
    .map((e) => ((balance += e.dr - e.cr), { date: e.d, doc: e.doc, text: e.text, debit: money(e.dr), credit: money(e.cr), balance: money(balance) }));
  res.json({
    type: "statement",
    title: "Statement of Account",
    company: get("SELECT * FROM company_profile WHERE id = 1"),
    statement: { customer: c, from: from === "0000-01-01" ? null : from, to, opening: money(opening), closing: money(balance), lines },
  });
});

extrasRouter.get("/print/quotation/:id", requirePermission("sd.orders.read"), (req, res) => {
  const q = loadQuote(req.params.id);
  if (!q) return res.status(404).json({ error: "Quotation not found" });
  const customer = get("SELECT * FROM customers WHERE id = ?", [q.customer_id]);
  const vat = Math.round(q.total * 15) / 100;
  res.json({ type: "quotation", title: "Quotation", company: get("SELECT * FROM company_profile WHERE id = 1"), quotation: { ...q, customer, vat, grand: q.total + vat } });
});

extrasRouter.get("/backup", requirePermission("security.users.write"), (req, res) => {
  const file = path.join(os.tmpdir(), `byapar-download-${Date.now()}.sqlite`);
  snapshot(file);
  audit(req, { action: "DOWNLOAD", entityType: "backup", entityId: today() });
  res.download(file, `byapar-backup-${today()}.sqlite`, () => fs.rmSync(file, { force: true }));
});

extrasRouter.get("/backups", requirePermission("security.users.write"), (_req, res) => res.json(backupStatus()));

extrasRouter.post("/backups/run", requirePermission("security.users.write"), (req, res) => {
  const result = runBackup();
  audit(req, { action: "BACKUP", entityType: "backup", entityId: path.basename(result.file) });
  res.status(201).json(result);
});

extrasRouter.put("/backups/settings", requirePermission("security.users.write"), (req, res) => {
  const dir = String(req.body?.dir || "").trim();
  try {
    setBackupDir(dir);
  } catch (err) {
    return res.status(400).json({ error: err.status ? err.message : `Cannot use that folder: ${err.message}` });
  }
  audit(req, { action: "UPDATE", entityType: "backup_settings", entityId: "backup_dir", after: { dir } });
  res.json(backupStatus());
});

/** Rows → RFC 4180 CSV (quotes fields containing comma, quote or newline). */
export function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\r\n");
}

function sendCsv(res, filename, csv) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("\uFEFF" + csv);
}

extrasRouter.get("/export/audit", requirePermission("security.audit.read"), (_req, res) => {
  const rows = all("SELECT * FROM audit_log ORDER BY id DESC LIMIT 5000");
  sendCsv(res, "audit.csv", toCsv(rows, ["id", "created_at", "actor_email", "action", "entity_type", "entity_id"]));
});

/** Mushak-style sales / purchase / note / TDS registers for the accountant — not the official NBR upload format. */
extrasRouter.get("/vat-return/export", requirePermission("reports.read", "fico.gl.read"), (req, res) => {
  const from = req.query.from || "2025-07-01";
  const to = req.query.to || today();
  const row = (register) => (r) => ({
    register,
    date: r.d,
    doc_no: r.doc,
    party: r.party,
    bin: r.bin,
    net: money(r.gross - r.vat),
    vat: money(r.vat),
    gross: money(r.gross),
    reference: r.ref || "",
  });
  const q = (sql) => all(sql, [from, to]);
  const rows = [
    ...q(`SELECT i.invoice_date d, i.invoice_no doc, c.name party, c.tax_id bin, i.amount_cents gross, i.tax_cents vat, i.description ref
          FROM ar_invoices i JOIN customers c ON c.id = i.customer_id WHERE i.invoice_date BETWEEN ? AND ? ORDER BY i.invoice_date, i.id`).map(row("Sales (output VAT)")),
    ...q(`SELECT i.invoice_date d, i.invoice_no doc, v.name party, v.tax_id bin, i.amount_cents gross, i.tax_cents vat, i.description ref
          FROM ap_invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.invoice_date BETWEEN ? AND ? ORDER BY i.invoice_date, i.id`).map(row("Purchases (input VAT)")),
    ...q(`SELECT n.note_date d, n.note_no doc, c.name party, c.tax_id bin, n.amount_cents gross, n.tax_cents vat, i.invoice_no || ' — ' || n.reason ref
          FROM invoice_notes n JOIN ar_invoices i ON i.id = n.invoice_id JOIN customers c ON c.id = i.customer_id
          WHERE n.kind = 'credit' AND n.note_date BETWEEN ? AND ? ORDER BY n.note_date, n.id`).map(row("Credit notes (Mushak 6.7)")),
    ...q(`SELECT n.note_date d, n.note_no doc, v.name party, v.tax_id bin, n.amount_cents gross, n.tax_cents vat, i.invoice_no || ' — ' || n.reason ref
          FROM invoice_notes n JOIN ap_invoices i ON i.id = n.invoice_id JOIN vendors v ON v.id = i.vendor_id
          WHERE n.kind = 'debit' AND n.note_date BETWEEN ? AND ? ORDER BY n.note_date, n.id`).map(row("Debit notes (Mushak 6.8)")),
    ...q(`SELECT p.payment_date d, p.payment_no doc, v.name party, v.tax_id bin, p.amount_cents gross, 0 vat, i.invoice_no ref, p.tds_cents tds
          FROM ap_payments p JOIN vendors v ON v.id = p.vendor_id LEFT JOIN ap_invoices i ON i.id = p.invoice_id
          WHERE p.tds_cents > 0 AND p.payment_date BETWEEN ? AND ? ORDER BY p.payment_date, p.id`).map((r) => ({
      ...row("TDS withheld (deposit to NBR)")(r),
      net: "",
      vat: "",
      tds: money(r.tds),
    })),
  ];
  sendCsv(res, `vat-registers-${from}-to-${to}.csv`, toCsv(rows, ["register", "date", "doc_no", "party", "bin", "net", "vat", "gross", "tds", "reference"]));
});

extrasRouter.post("/import/materials", requirePermission("mm.materials.write"), (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: "rows[] required: sku,name,type,uom,stdPrice,reorderMin" });
  let created = 0;
  tx(() => {
    for (const row of rows) {
      if (!row.sku || !row.name) continue;
      const exists = get("SELECT id FROM materials WHERE sku = ?", [row.sku]);
      if (exists) {
        run("UPDATE materials SET name = ?, reorder_min = ?, reorder_max = ? WHERE id = ?", [
          row.name,
          Number(row.reorderMin) || 0,
          Number(row.reorderMax) || 0,
          exists.id,
        ]);
      } else {
        const r = run(
          "INSERT INTO materials (sku, name, type, uom, std_price_cents, reorder_min, reorder_max) VALUES (?,?,?,?,?,?,?)",
          [
            row.sku,
            row.name,
            row.type || "raw",
            row.uom || "EA",
            cents(Number(row.stdPrice) || 0),
            Number(row.reorderMin) || 0,
            Number(row.reorderMax) || 0,
          ]
        );
        const loc = get("SELECT id FROM storage_locations ORDER BY id LIMIT 1");
        if (loc) run("INSERT INTO inventory (material_id, storage_location_id, qty_on_hand) VALUES (?,?,0)", [r.lastInsertRowid, loc.id]);
        created += 1;
      }
    }
  });
  audit(req, { action: "IMPORT", entityType: "materials", entityId: String(created) });
  res.json({ ok: true, created });
});

extrasRouter.get("/role-home", requirePermission("dashboard.read"), (req, res) => {
  const roles = req.user.roles || [];
  const cards = [];
  if (roles.includes("BUYER") || roles.includes("ADMIN")) {
    cards.push({
      role: "Buyer",
      items: [
        { label: "Open POs", value: get("SELECT COUNT(*) AS n FROM purchase_orders WHERE status IN ('open','partial')").n, to: "/purchase-orders" },
        { label: "Reorder alerts", value: all(`SELECT m.id FROM materials m LEFT JOIN inventory i ON i.material_id=m.id GROUP BY m.id HAVING m.reorder_min>0 AND COALESCE(SUM(i.qty_on_hand),0)<m.reorder_min`).length, to: "/reorder" },
      ],
    });
  }
  if (roles.includes("SALES") || roles.includes("ADMIN")) {
    cards.push({
      role: "Sales",
      items: [
        { label: "Open SOs", value: get("SELECT COUNT(*) AS n FROM sales_orders WHERE status IN ('open','partial','delivered')").n, to: "/sales-orders" },
        { label: "Open AR", value: get("SELECT COUNT(*) AS n FROM ar_invoices WHERE status IN ('open','partial')").n, to: "/ar" },
      ],
    });
  }
  if (roles.includes("ACCOUNTANT") || roles.includes("ADMIN")) {
    cards.push({
      role: "Accountant",
      items: [
        { label: "Open AP", value: get("SELECT COUNT(*) AS n FROM ap_invoices WHERE status IN ('open','partial')").n, to: "/ap" },
        { label: "Pending approvals", value: get("SELECT COUNT(*) AS n FROM approval_requests WHERE status='pending'").n, to: "/approvals" },
      ],
    });
  }
  if (roles.includes("PLANNER") || roles.includes("ADMIN")) {
    cards.push({
      role: "Planner",
      items: [
        { label: "Open production", value: get("SELECT COUNT(*) AS n FROM production_orders WHERE status IN ('released','in_progress')").n, to: "/production" },
        { label: "MRP suggestions", value: "Run", to: "/mrp" },
      ],
    });
  }
  res.json({ cards, user: req.user.name, roles });
});

/* ——— Bank reconciliation (account 1100, DBBL) ——— */

/** Pairs statement lines with bank GL lines of the same signed amount within `days`; skips anything ambiguous. */
export function autoMatch(stmtLines, glLines, days = 3) {
  const used = new Set();
  const pairs = [];
  for (const s of stmtLines) {
    const hits = glLines.filter(
      (g) => !used.has(g.id) && g.amount_cents === s.amount_cents && Math.abs(Date.parse(g.posting_date) - Date.parse(s.stmt_date)) <= days * 86400000
    );
    if (hits.length !== 1) continue;
    used.add(hits[0].id);
    pairs.push([s.id, hits[0].id]);
  }
  return pairs;
}

function unmatchedBankGl() {
  return all(
    `SELECT l.id, h.posting_date, h.doc_number, COALESCE(NULLIF(l.text, ''), h.description) AS text, l.debit_cents - l.credit_cents AS amount_cents
     FROM journal_lines l
     JOIN journal_headers h ON h.id = l.header_id
     JOIN gl_accounts a ON a.id = l.account_id
     WHERE a.code = '1100' AND h.status = 'posted' AND l.id NOT IN (SELECT journal_line_id FROM bank_statement_lines WHERE journal_line_id IS NOT NULL)
     ORDER BY h.posting_date, l.id`
  );
}

const unmatchedStatement = () => all("SELECT * FROM bank_statement_lines WHERE journal_line_id IS NULL ORDER BY stmt_date, id");
const withMoney = (r) => ({ ...r, amount: money(r.amount_cents) });

extrasRouter.get("/bank-rec", requirePermission("fico.gl.read"), (_req, res) => {
  const statement = unmatchedStatement().map(withMoney);
  const gl = unmatchedBankGl().map(withMoney);
  const matched = all(
    `SELECT s.*, h.doc_number, h.posting_date FROM bank_statement_lines s
     JOIN journal_lines l ON l.id = s.journal_line_id JOIN journal_headers h ON h.id = l.header_id
     ORDER BY s.stmt_date DESC, s.id DESC LIMIT 100`
  ).map(withMoney);
  res.json({
    glBalance: money(accountBalance("1100")?.balance_cents || 0),
    statementTotal: money(get("SELECT COALESCE(SUM(amount_cents),0) AS c FROM bank_statement_lines").c),
    unmatchedStatementTotal: money(statement.reduce((s, r) => s + r.amount_cents, 0)),
    unmatchedGlTotal: money(gl.reduce((s, r) => s + r.amount_cents, 0)),
    statement,
    gl,
    matched,
  });
});

extrasRouter.post("/bank-rec/import", requirePermission("fico.gl.write"), (req, res) => {
  const parsed = z
    .object({
      rows: z
        .array(
          z.object({
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD"),
            description: z.string().default(""),
            reference: z.string().default(""),
            amount: z.number().finite().refine((n) => n !== 0, "Amount cannot be 0"),
          })
        )
        .min(1)
        .max(5000),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  let added = 0;
  tx(() => {
    for (const r of parsed.data.rows) {
      const result = run(
        "INSERT OR IGNORE INTO bank_statement_lines (stmt_date, description, reference, amount_cents) VALUES (?,?,?,?)",
        [r.date, r.description.trim(), r.reference.trim(), cents(r.amount)]
      );
      added += Number(result.changes);
    }
  });
  audit(req, { action: "IMPORT", entityType: "bank_statement", entityId: String(added) });
  res.json({ added, skipped: parsed.data.rows.length - added });
});

extrasRouter.post("/bank-rec/auto", requirePermission("fico.gl.write"), (req, res) => {
  const pairs = autoMatch(unmatchedStatement(), unmatchedBankGl());
  tx(() => {
    for (const [sid, gid] of pairs) run("UPDATE bank_statement_lines SET journal_line_id = ? WHERE id = ?", [gid, sid]);
  });
  audit(req, { action: "AUTO_MATCH", entityType: "bank_statement", entityId: String(pairs.length) });
  res.json({ matched: pairs.length });
});

extrasRouter.post("/bank-rec/match", requirePermission("fico.gl.write"), (req, res) => {
  const parsed = z.object({ statementLineId: z.number(), journalLineId: z.number() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "statementLineId and journalLineId required" });
  const s = get("SELECT * FROM bank_statement_lines WHERE id = ? AND journal_line_id IS NULL", [parsed.data.statementLineId]);
  const g = unmatchedBankGl().find((l) => l.id === parsed.data.journalLineId);
  if (!s || !g) return res.status(400).json({ error: "Both lines must exist and be unmatched" });
  if (s.amount_cents !== g.amount_cents) return res.status(400).json({ error: `Amounts differ: statement ${money(s.amount_cents)} vs ledger ${money(g.amount_cents)}` });
  run("UPDATE bank_statement_lines SET journal_line_id = ? WHERE id = ?", [g.id, s.id]);
  audit(req, { action: "MATCH", entityType: "bank_statement", entityId: String(s.id), after: { journal: g.doc_number } });
  res.json({ ok: true });
});

extrasRouter.post("/bank-rec/:id/unmatch", requirePermission("fico.gl.write"), (req, res) => {
  run("UPDATE bank_statement_lines SET journal_line_id = NULL WHERE id = ?", [req.params.id]);
  audit(req, { action: "UNMATCH", entityType: "bank_statement", entityId: String(req.params.id) });
  res.json({ ok: true });
});

/** Queues an approval when amount ≥ the approval limit, or always when `force` (e.g. customer over credit limit). */
export function requestApprovalIfNeeded(req, { entityType, entityId, entityNo, amountCents, force = false }) {
  const limit = cents(approvalLimit());
  if (!force && amountCents < limit) return { needed: false };
  const r = run(
    `INSERT INTO approval_requests (entity_type, entity_id, entity_no, amount_cents, status, requested_by)
     VALUES (?,?,?,?, 'pending', ?)`,
    [entityType, entityId, entityNo, amountCents, req.user.id]
  );
  return { needed: true, approvalId: Number(r.lastInsertRowid) };
}
