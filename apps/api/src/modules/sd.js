import { Router } from "express";
import { z } from "zod";
import { all, get, run, tx, cents, money, today, nextNumber } from "../db.js";
import { audit } from "../audit.js";
import { requirePermission } from "../auth.js";
import { postJournal } from "../posting.js";
import { requestApprovalIfNeeded } from "./extras.js";

export const sdRouter = Router();

function loadSO(id) {
  const so = get(
    `SELECT s.*, c.code AS customer_code, c.name AS customer_name
     FROM sales_orders s JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`,
    [id]
  );
  if (!so) return null;
  const lines = all(
    `SELECT l.*, m.sku, m.name AS material_name, m.uom, m.std_price_cents
     FROM so_lines l JOIN materials m ON m.id = l.material_id
     WHERE l.so_id = ? ORDER BY l.line_no`,
    [id]
  ).map((l) => ({
    ...l,
    unitPrice: money(l.unit_price_cents),
    lineTotal: money(Math.round(l.qty * l.unit_price_cents)),
    qtyOpen: Math.max(0, l.qty - l.qty_delivered),
    qtyBillable: Math.max(0, l.qty_delivered - l.qty_billed),
  }));
  return { ...so, lines, total: lines.reduce((s, l) => s + l.lineTotal, 0) };
}

sdRouter.get("/orders", requirePermission("sd.orders.read"), (_req, res) => {
  const ids = all("SELECT id FROM sales_orders ORDER BY id DESC");
  res.json({ salesOrders: ids.map((r) => loadSO(r.id)) });
});

sdRouter.get("/orders/:id", requirePermission("sd.orders.read"), (req, res) => {
  const so = loadSO(req.params.id);
  if (!so) return res.status(404).json({ error: "Sales order not found" });
  res.json({ salesOrder: so });
});

const linesSchema = z
  .array(z.object({ materialId: z.number(), qty: z.number().positive(), unitPrice: z.number().nonnegative() }))
  .min(1);

/** What the customer owes plus what is ordered but not yet billed (with 15% VAT), in paisa. */
export function customerExposure(customerId) {
  const ar = get("SELECT COALESCE(SUM(amount_cents - settled_cents),0) AS c FROM ar_invoices WHERE customer_id = ? AND status IN ('open','partial')", [customerId]).c;
  const unbilled = get(
    `SELECT COALESCE(SUM((l.qty - l.qty_billed) * l.unit_price_cents), 0) AS c FROM so_lines l JOIN sales_orders s ON s.id = l.so_id
     WHERE s.customer_id = ? AND s.status <> 'complete' AND s.approval_status <> 'rejected'`,
    [customerId]
  ).c;
  return ar + Math.round(unbilled * 1.15);
}

/** Inserts an SO (approval above the approval limit or when it breaks the customer's credit limit). Caller must wrap in tx(). */
function createSalesOrder(req, { customerId, orderDate, notes, lines }) {
  const no = nextNumber("SO");
  const totalCents = lines.reduce((s, l) => s + Math.round(l.qty * cents(l.unitPrice)), 0);
  const limitRow = get("SELECT value FROM app_settings WHERE key = 'approval_limit_bdt'");
  const creditLimit = get("SELECT credit_limit_cents FROM customers WHERE id = ?", [customerId])?.credit_limit_cents || 0;
  const overCredit = creditLimit > 0 && customerExposure(customerId) + Math.round(totalCents * 1.15) > creditLimit;
  const needsApproval = overCredit || totalCents >= Math.round(Number(limitRow?.value || 50000) * 100);
  const r = run(
    "INSERT INTO sales_orders (so_number, customer_id, order_date, status, notes, created_by, approval_status) VALUES (?, ?, ?, 'open', ?, ?, ?)",
    [no, customerId, orderDate || today(), notes || "", req.user.id, needsApproval ? "pending" : "approved"]
  );
  lines.forEach((line, i) => {
    run("INSERT INTO so_lines (so_id, line_no, material_id, qty, unit_price_cents) VALUES (?, ?, ?, ?, ?)", [
      r.lastInsertRowid,
      i + 1,
      line.materialId,
      line.qty,
      cents(line.unitPrice),
    ]);
  });
  if (needsApproval) {
    requestApprovalIfNeeded(req, {
      entityType: "sales_order",
      entityId: Number(r.lastInsertRowid),
      entityNo: overCredit ? `${no} (over credit limit ${money(creditLimit)})` : no,
      amountCents: totalCents,
      force: overCredit,
    });
  }
  audit(req, { action: "CREATE", entityType: "sales_order", entityId: no });
  return { ...loadSO(r.lastInsertRowid), overCredit };
}

sdRouter.post("/orders", requirePermission("sd.orders.write"), (req, res) => {
  const parsed = z
    .object({ customerId: z.number(), orderDate: z.string().optional(), notes: z.string().optional(), lines: linesSchema })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  if (!get("SELECT id FROM customers WHERE id = ?", [parsed.data.customerId])) return res.status(400).json({ error: "Customer not found" });
  const so = tx(() => createSalesOrder(req, parsed.data));
  res.status(201).json({ salesOrder: so });
});

/* ——— Price lists ——— */

sdRouter.get("/price-lists", requirePermission("sd.orders.read"), (_req, res) => {
  const rows = all(
    `SELECT p.*, c.name AS customer_name, m.sku, m.name AS material_name, m.std_price_cents
     FROM price_lists p JOIN customers c ON c.id = p.customer_id JOIN materials m ON m.id = p.material_id
     ORDER BY c.name, m.sku`
  ).map((p) => ({ ...p, unitPrice: money(p.unit_price_cents), netPrice: money(Math.round(p.unit_price_cents * (1 - p.discount_pct / 100))) }));
  res.json({ priceLists: rows });
});

sdRouter.post("/price-lists", requirePermission("sd.orders.write"), (req, res) => {
  const parsed = z
    .object({ customerId: z.number(), materialId: z.number(), unitPrice: z.number().nonnegative(), discountPct: z.number().min(0).max(100).default(0) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;
  run(
    `INSERT INTO price_lists (customer_id, material_id, unit_price_cents, discount_pct) VALUES (?, ?, ?, ?)
     ON CONFLICT (customer_id, material_id) DO UPDATE SET unit_price_cents = excluded.unit_price_cents, discount_pct = excluded.discount_pct`,
    [d.customerId, d.materialId, cents(d.unitPrice), d.discountPct]
  );
  audit(req, { action: "UPSERT", entityType: "price_list", entityId: `${d.customerId}/${d.materialId}`, after: d });
  res.status(201).json({ ok: true });
});

sdRouter.delete("/price-lists/:id", requirePermission("sd.orders.write"), (req, res) => {
  run("DELETE FROM price_lists WHERE id = ?", [req.params.id]);
  audit(req, { action: "DELETE", entityType: "price_list", entityId: String(req.params.id) });
  res.json({ ok: true });
});

/** Customer price-list price after discount, else standard cost + 75% default markup. */
sdRouter.get("/price", requirePermission("sd.orders.read"), (req, res) => {
  const p = get("SELECT unit_price_cents, discount_pct FROM price_lists WHERE customer_id = ? AND material_id = ?", [req.query.customerId, req.query.materialId]);
  if (p) return res.json({ unitPrice: money(Math.round(p.unit_price_cents * (1 - p.discount_pct / 100))), source: "price_list" });
  const m = get("SELECT std_price_cents FROM materials WHERE id = ?", [req.query.materialId]);
  res.json({ unitPrice: money(Math.round((m?.std_price_cents || 0) * 1.75)), source: "standard" });
});

/* ——— Quotations ——— */

export function loadQuote(id) {
  const q = get(
    `SELECT q.*, c.name AS customer_name, s.so_number FROM quotations q
     JOIN customers c ON c.id = q.customer_id LEFT JOIN sales_orders s ON s.id = q.so_id WHERE q.id = ?`,
    [id]
  );
  if (!q) return null;
  const lines = all(
    `SELECT l.*, m.sku, m.name AS material_name, m.uom FROM quotation_lines l JOIN materials m ON m.id = l.material_id
     WHERE l.quote_id = ? ORDER BY l.line_no`,
    [id]
  ).map((l) => ({ ...l, unitPrice: money(l.unit_price_cents), lineTotal: money(Math.round(l.qty * l.unit_price_cents)) }));
  return { ...q, lines, total: money(lines.reduce((s, l) => s + Math.round(l.qty * l.unit_price_cents), 0)) };
}

sdRouter.get("/quotations", requirePermission("sd.orders.read"), (_req, res) => {
  res.json({ quotations: all("SELECT id FROM quotations ORDER BY id DESC").map((r) => loadQuote(r.id)) });
});

sdRouter.post("/quotations", requirePermission("sd.orders.write"), (req, res) => {
  const parsed = z
    .object({ customerId: z.number(), quoteDate: z.string().optional(), validUntil: z.string().optional(), notes: z.string().optional(), lines: linesSchema })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;
  if (!get("SELECT id FROM customers WHERE id = ?", [d.customerId])) return res.status(400).json({ error: "Customer not found" });
  const quote = tx(() => {
    const no = nextNumber("QUOTE");
    const quoteDate = d.quoteDate || today();
    const validUntil = d.validUntil || new Date(Date.parse(quoteDate) + 15 * 86400000).toISOString().slice(0, 10);
    const r = run(
      "INSERT INTO quotations (quote_no, customer_id, quote_date, valid_until, status, notes, created_by) VALUES (?, ?, ?, ?, 'open', ?, ?)",
      [no, d.customerId, quoteDate, validUntil, d.notes || "", req.user.id]
    );
    d.lines.forEach((l, i) =>
      run("INSERT INTO quotation_lines (quote_id, line_no, material_id, qty, unit_price_cents) VALUES (?, ?, ?, ?, ?)", [
        r.lastInsertRowid,
        i + 1,
        l.materialId,
        l.qty,
        cents(l.unitPrice),
      ])
    );
    audit(req, { action: "CREATE", entityType: "quotation", entityId: no });
    return loadQuote(r.lastInsertRowid);
  });
  res.status(201).json({ quotation: quote });
});

sdRouter.post("/quotations/:id/convert", requirePermission("sd.orders.write"), (req, res) => {
  const q = loadQuote(req.params.id);
  if (!q) return res.status(404).json({ error: "Quotation not found" });
  if (q.status !== "open") return res.status(400).json({ error: `Quotation is ${q.status}` });
  if (q.valid_until < today()) return res.status(400).json({ error: `Quotation expired on ${q.valid_until}` });
  const so = tx(() => {
    const created = createSalesOrder(req, {
      customerId: q.customer_id,
      notes: `From quotation ${q.quote_no}${q.notes ? ` — ${q.notes}` : ""}`,
      lines: q.lines.map((l) => ({ materialId: l.material_id, qty: l.qty, unitPrice: l.unitPrice })),
    });
    run("UPDATE quotations SET status = 'converted', so_id = ? WHERE id = ?", [created.id, q.id]);
    return created;
  });
  res.status(201).json({ salesOrder: so });
});

sdRouter.post("/quotations/:id/cancel", requirePermission("sd.orders.write"), (req, res) => {
  const r = run("UPDATE quotations SET status = 'cancelled' WHERE id = ? AND status = 'open'", [req.params.id]);
  if (!r.changes) return res.status(400).json({ error: "Only open quotations can be cancelled" });
  audit(req, { action: "CANCEL", entityType: "quotation", entityId: String(req.params.id) });
  res.json({ ok: true });
});

sdRouter.post("/orders/:id/deliver", requirePermission("sd.deliver.write"), (req, res) => {
  const parsed = z
    .object({
      storageLocationId: z.number(),
      lines: z.array(z.object({ soLineId: z.number(), qty: z.number().positive() })).min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const so = get("SELECT * FROM sales_orders WHERE id = ?", [req.params.id]);
  if (!so) return res.status(404).json({ error: "Sales order not found" });
  if (so.approval_status === "pending") return res.status(400).json({ error: "Sales order awaiting approval" });
  if (so.approval_status === "rejected") return res.status(400).json({ error: "Sales order was rejected" });
  const loc = get("SELECT * FROM storage_locations WHERE id = ?", [parsed.data.storageLocationId]);
  if (!loc) return res.status(400).json({ error: "Storage location not found" });

  try {
    const result = tx((db) => {
      let cogsTotal = 0;
      const delNo = nextNumber("DN");
      const del = run(
        "INSERT INTO deliveries (delivery_no, so_id, delivery_date, status, created_by) VALUES (?, ?, ?, 'posted', ?)",
        [delNo, so.id, today(), req.user.id]
      );

      for (const item of parsed.data.lines) {
        const line = get("SELECT * FROM so_lines WHERE id = ? AND so_id = ?", [item.soLineId, so.id]);
        if (!line) throw Object.assign(new Error("SO line not found"), { status: 400 });
        const open = line.qty - line.qty_delivered;
        if (item.qty > open + 1e-9) throw Object.assign(new Error("Deliver qty exceeds open qty"), { status: 400 });
        const material = get("SELECT * FROM materials WHERE id = ?", [line.material_id]);
        const inv = get("SELECT * FROM inventory WHERE material_id = ? AND storage_location_id = ?", [
          line.material_id,
          loc.id,
        ]);
        if (!inv || inv.qty_on_hand < item.qty) {
          throw Object.assign(new Error(`Insufficient stock for ${material.sku}`), { status: 400 });
        }
        const value = Math.round(item.qty * material.std_price_cents);
        cogsTotal += value;

        run("UPDATE so_lines SET qty_delivered = qty_delivered + ? WHERE id = ?", [item.qty, line.id]);
        run("UPDATE inventory SET qty_on_hand = qty_on_hand - ? WHERE id = ?", [item.qty, inv.id]);
        run(
          `INSERT INTO delivery_lines (delivery_id, so_line_id, material_id, qty, storage_location_id) VALUES (?, ?, ?, ?, ?)`,
          [del.lastInsertRowid, line.id, line.material_id, item.qty, loc.id]
        );
        const giNo = nextNumber("GI");
        run(
          `INSERT INTO goods_movements (movement_no, movement_type, material_id, storage_location_id, qty, unit_cost_cents, ref_type, ref_id, created_by)
           VALUES (?, 'GI', ?, ?, ?, ?, 'DN', ?, ?)`,
          [giNo, line.material_id, loc.id, item.qty, material.std_price_cents, delNo, req.user.id]
        );
      }

      const posted = postJournal(db, {
        date: today(),
        postingDate: today(),
        sourceModule: "SD",
        sourceId: delNo,
        description: `Delivery ${delNo} for ${so.so_number}`,
        userId: req.user.id,
        lines: [
          { accountCode: "5000", debit: money(cogsTotal), text: `COGS ${delNo}` },
          { accountCode: "1300", credit: money(cogsTotal), text: `Inventory ${delNo}` },
        ],
      });
      run("UPDATE deliveries SET journal_id = ? WHERE id = ?", [posted.id, del.lastInsertRowid]);
      run(
        `UPDATE goods_movements SET journal_id = ? WHERE ref_type = 'DN' AND ref_id = ?`,
        [posted.id, delNo]
      );

      const lines = all("SELECT qty, qty_delivered FROM so_lines WHERE so_id = ?", [so.id]);
      const fully = lines.every((l) => l.qty_delivered + 1e-9 >= l.qty);
      const anyBill = all("SELECT qty_billed FROM so_lines WHERE so_id = ?", [so.id]).some((l) => l.qty_billed > 0);
      run("UPDATE sales_orders SET status = ? WHERE id = ?", [fully ? (anyBill ? "complete" : "delivered") : "partial", so.id]);

      audit(req, { action: "DELIVER", entityType: "sales_order", entityId: so.so_number, after: { delivery: delNo, journal: posted.docNumber } });
      return { deliveryNo: delNo, journal: posted.docNumber };
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

sdRouter.post("/orders/:id/bill", requirePermission("sd.billing.write"), (req, res) => {
  const so = loadSO(req.params.id);
  if (!so) return res.status(404).json({ error: "Sales order not found" });
  const billable = so.lines.filter((l) => l.qtyBillable > 0);
  if (!billable.length) return res.status(400).json({ error: "Nothing to bill — deliver first" });

  try {
    const result = tx((db) => {
      const invNo = nextNumber("AR_INV");
      let net = 0;
      for (const l of billable) {
        net += Math.round(l.qtyBillable * l.unit_price_cents);
        run("UPDATE so_lines SET qty_billed = qty_billed + ? WHERE id = ?", [l.qtyBillable, l.id]);
      }
      const tax = Math.round(net * 0.15);
      const gross = net + tax;
      const posted = postJournal(db, {
        date: today(),
        postingDate: today(),
        sourceModule: "SD",
        sourceId: so.so_number,
        description: `Billing ${so.so_number} → ${invNo}`,
        userId: req.user.id,
        lines: [
          { accountCode: "1200", debit: money(gross), text: `AR ${so.customer_name}` },
          { accountCode: "4000", credit: money(net), text: so.so_number },
          { accountCode: "2300", credit: money(tax), text: "Output VAT 15% (NBR / Mushak)" },
        ],
      });
      const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      run(
        `INSERT INTO ar_invoices (invoice_no, customer_id, invoice_date, due_date, amount_cents, tax_cents, description, status, journal_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        [invNo, so.customer_id, today(), due, gross, tax, `Billing ${so.so_number}`, posted.id, req.user.id]
      );
      const lines = all("SELECT qty, qty_delivered, qty_billed FROM so_lines WHERE so_id = ?", [so.id]);
      const done = lines.every((l) => l.qty_billed + 1e-9 >= l.qty_delivered && l.qty_delivered + 1e-9 >= l.qty);
      run("UPDATE sales_orders SET status = ? WHERE id = ?", [done ? "complete" : so.status === "open" ? "partial" : so.status, so.id]);
      audit(req, { action: "BILL", entityType: "sales_order", entityId: so.so_number, after: { invoice: invNo, journal: posted.docNumber } });
      return { invoiceNo: invNo, journal: posted.docNumber, amount: money(gross) };
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

sdRouter.get("/deliveries", requirePermission("sd.orders.read"), (_req, res) => {
  const rows = all(
    `SELECT d.*, s.so_number, c.name AS customer_name, h.doc_number AS journal_no
     FROM deliveries d
     JOIN sales_orders s ON s.id = d.so_id
     JOIN customers c ON c.id = s.customer_id
     LEFT JOIN journal_headers h ON h.id = d.journal_id
     ORDER BY d.id DESC`
  );
  res.json({ deliveries: rows });
});
