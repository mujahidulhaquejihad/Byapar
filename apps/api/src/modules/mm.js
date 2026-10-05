import { Router } from "express";
import { z } from "zod";
import { all, get, run, tx, cents, money, today, nextNumber } from "../db.js";
import { audit } from "../audit.js";
import { requirePermission } from "../auth.js";
import { postJournal, cashAccount, nonZero } from "../posting.js";
import { requestApprovalIfNeeded } from "./extras.js";

export const mmRouter = Router();

function invRows() {
  return all(
    `SELECT i.*, m.sku, m.name AS material_name, m.uom, m.std_price_cents, m.type,
            s.code AS location_code, s.name AS location_name, w.code AS warehouse_code
     FROM inventory i
     JOIN materials m ON m.id = i.material_id
     JOIN storage_locations s ON s.id = i.storage_location_id
     JOIN warehouses w ON w.id = s.warehouse_id
     ORDER BY m.sku, s.code`
  ).map((r) => ({
    ...r,
    stdPrice: money(r.std_price_cents),
    value: money(Math.round(r.qty_on_hand * r.std_price_cents)),
  }));
}

mmRouter.get("/materials", requirePermission("mm.materials.read"), (_req, res) => {
  const materials = all("SELECT * FROM materials ORDER BY sku").map((m) => ({ ...m, stdPrice: money(m.std_price_cents) }));
  res.json({ materials });
});

mmRouter.post("/materials", requirePermission("mm.materials.write"), (req, res) => {
  const parsed = z
    .object({
      name: z.string().min(1),
      type: z.enum(["raw", "semi", "finished", "consumable"]).default("raw"),
      uom: z.string().default("EA"),
      stdPrice: z.number().nonnegative().default(0),
      sku: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const sku = parsed.data.sku || nextNumber("MATERIAL");
  try {
    const r = run(
      "INSERT INTO materials (sku, name, type, uom, std_price_cents) VALUES (?, ?, ?, ?, ?)",
      [sku, parsed.data.name, parsed.data.type, parsed.data.uom, cents(parsed.data.stdPrice)]
    );
    const material = get("SELECT * FROM materials WHERE id = ?", [r.lastInsertRowid]);
    const loc = get("SELECT id FROM storage_locations ORDER BY id LIMIT 1");
    if (loc) run("INSERT INTO inventory (material_id, storage_location_id, qty_on_hand) VALUES (?, ?, 0)", [material.id, loc.id]);
    audit(req, { action: "CREATE", entityType: "material", entityId: sku, after: material });
    res.status(201).json({ material: { ...material, stdPrice: money(material.std_price_cents) } });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) return res.status(409).json({ error: "SKU already exists" });
    throw err;
  }
});

mmRouter.get("/inventory", requirePermission("mm.inventory.read"), (_req, res) => {
  const rows = invRows();
  res.json({
    inventory: rows,
    totalValue: rows.reduce((s, r) => s + r.value, 0),
    locations: all(
      `SELECT s.id, s.code, s.name, w.code AS warehouse_code, w.name AS warehouse_name
       FROM storage_locations s JOIN warehouses w ON w.id = s.warehouse_id ORDER BY w.code, s.code`
    ),
  });
});

/** Qty as of a date = on-hand now minus movements after it, valued at standard price; compared to GL 1300. */
mmRouter.get("/stock-valuation", requirePermission("mm.inventory.read"), (req, res) => {
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf || "") ? req.query.asOf : today();
  // ponytail: movement created_at is UTC, so moves between 00:00–06:00 Dhaka time land on the previous day; add a movement_date column if that matters.
  const rows = all(
    `SELECT m.id, m.sku, m.name, m.type, m.uom, m.std_price_cents,
            COALESCE((SELECT SUM(qty_on_hand) FROM inventory WHERE material_id = m.id), 0)
            - COALESCE((SELECT SUM(CASE movement_type WHEN 'GR' THEN qty ELSE -qty END) FROM goods_movements
                        WHERE material_id = m.id AND substr(created_at, 1, 10) > ?), 0) AS qty
     FROM materials m ORDER BY m.type, m.sku`,
    [asOf]
  )
    .filter((r) => Math.abs(r.qty) > 1e-9)
    .map((r) => ({ ...r, stdPrice: money(r.std_price_cents), value: money(Math.round(r.qty * r.std_price_cents)) }));
  const stockCents = rows.reduce((s, r) => s + Math.round(r.qty * r.std_price_cents), 0);
  const glCents = get(
    `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS c FROM journal_lines l
     JOIN journal_headers h ON h.id = l.header_id JOIN gl_accounts a ON a.id = l.account_id
     WHERE a.code = '1300' AND h.status = 'posted' AND h.posting_date <= ?`,
    [asOf]
  ).c;
  res.json({ asOf, rows, stockValue: money(stockCents), glValue: money(glCents), difference: money(glCents - stockCents) });
});

/* ——— Import LCs & landed cost ——— */

const LC_COST_TYPES = ["LC margin & commission", "Marine insurance", "Customs duty (CD/RD/SD)", "C&F agent", "Port & transport", "Other"];
const lcFail = (message) => Object.assign(new Error(message), { status: 400 });

function loadLc(id) {
  const lc = get(
    `SELECT l.*, p.po_number, v.name AS vendor_name, h.doc_number AS allocation_journal_no FROM lcs l
     JOIN purchase_orders p ON p.id = l.po_id JOIN vendors v ON v.id = p.vendor_id
     LEFT JOIN journal_headers h ON h.id = l.allocation_journal_id WHERE l.id = ?`,
    [id]
  );
  if (!lc) return null;
  const costs = all(
    "SELECT c.*, h.doc_number AS journal_no FROM lc_costs c LEFT JOIN journal_headers h ON h.id = c.journal_id WHERE c.lc_id = ? ORDER BY c.id",
    [id]
  ).map((c) => ({ ...c, amount: money(c.amount_cents) }));
  const goodsCents = get("SELECT COALESCE(SUM(qty_received * unit_price_cents),0) AS c FROM po_lines WHERE po_id = ?", [lc.po_id]).c;
  return { ...lc, costs, totalCosts: money(costs.reduce((s, c) => s + c.amount_cents, 0)), goodsReceived: money(goodsCents) };
}

/**
 * Spreads an LC's parked costs (1350) over the PO's received lines by value, then into each material's standard price.
 * ponytail: revalues all on-hand stock of the material (moving-average approximation); stock already sold sends its share to COGS.
 */
export function allocateLc(db, lcId, userId) {
  const lc = loadLc(lcId);
  if (!lc) throw lcFail("LC not found");
  if (lc.status !== "open") throw lcFail("LC costs are already allocated");
  const total = lc.costs.reduce((s, c) => s + c.amount_cents, 0);
  if (!total) throw lcFail("Add LC costs before allocating");
  const lines = all("SELECT material_id, SUM(qty_received * unit_price_cents) AS value FROM po_lines WHERE po_id = ? AND qty_received > 0 GROUP BY material_id", [lc.po_id]);
  const base = lines.reduce((s, l) => s + l.value, 0);
  if (!base) throw lcFail(`Receive goods on ${lc.po_number} before allocating`);
  const je = [];
  let given = 0;
  lines.forEach((l, i) => {
    const share = i === lines.length - 1 ? total - given : Math.round((total * l.value) / base);
    given += share;
    const m = get("SELECT * FROM materials WHERE id = ?", [l.material_id]);
    const qty = get("SELECT COALESCE(SUM(qty_on_hand),0) AS q FROM inventory WHERE material_id = ?", [m.id]).q;
    let reval = 0;
    if (qty > 0) {
      const newPrice = Math.round((qty * m.std_price_cents + share) / qty);
      reval = Math.round(qty * newPrice) - Math.round(qty * m.std_price_cents);
      run("UPDATE materials SET std_price_cents = ? WHERE id = ?", [newPrice, m.id]);
    }
    je.push({ accountCode: "1300", debit: money(reval), text: `Landed cost ${m.sku}` });
    je.push(share - reval >= 0 ? { accountCode: "5000", debit: money(share - reval), text: `Landed cost ${m.sku} (sold / rounding)` } : { accountCode: "5000", credit: money(reval - share), text: `Rounding ${m.sku}` });
  });
  je.push({ accountCode: "1350", credit: money(total), text: `Clear LC ${lc.lc_no}` });
  const posted = postJournal(db, {
    date: today(),
    postingDate: today(),
    sourceModule: "MM",
    sourceId: lc.lc_no,
    description: `Landed cost allocation ${lc.lc_no} (${lc.po_number})`,
    userId,
    lines: nonZero(je),
  });
  run("UPDATE lcs SET status = 'allocated', allocation_journal_id = ? WHERE id = ?", [posted.id, lc.id]);
  return { journal: posted.docNumber, allocated: money(total) };
}

mmRouter.get("/lcs", requirePermission("mm.po.read"), (_req, res) => {
  res.json({ lcs: all("SELECT id FROM lcs ORDER BY id DESC").map((r) => loadLc(r.id)), costTypes: LC_COST_TYPES });
});

mmRouter.post("/lcs", requirePermission("mm.po.write"), (req, res) => {
  const parsed = z
    .object({ poId: z.number(), bank: z.string().min(1), bankLcRef: z.string().default(""), lcDate: z.string().optional(), notes: z.string().default("") })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;
  if (!get("SELECT id FROM purchase_orders WHERE id = ?", [d.poId])) return res.status(400).json({ error: "PO not found" });
  const no = nextNumber("LC");
  const r = run("INSERT INTO lcs (lc_no, po_id, bank, bank_lc_ref, lc_date, notes, created_by) VALUES (?,?,?,?,?,?,?)", [
    no,
    d.poId,
    d.bank,
    d.bankLcRef,
    d.lcDate || today(),
    d.notes,
    req.user.id,
  ]);
  audit(req, { action: "CREATE", entityType: "lc", entityId: no });
  res.status(201).json({ lc: loadLc(r.lastInsertRowid) });
});

mmRouter.post("/lcs/:id/costs", requirePermission("mm.po.write"), (req, res) => {
  const parsed = z
    .object({ costType: z.enum(LC_COST_TYPES), amount: z.number().positive(), date: z.string().optional(), accountCode: z.string().default("1100"), reference: z.string().default("") })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const lc = get("SELECT * FROM lcs WHERE id = ?", [req.params.id]);
  if (!lc) return res.status(404).json({ error: "LC not found" });
  if (lc.status !== "open") return res.status(400).json({ error: "LC already allocated — costs are closed" });
  const d = parsed.data;
  try {
    const result = tx((db) => {
      const account = cashAccount(d.accountCode);
      const date = d.date || today();
      const posted = postJournal(db, {
        date,
        postingDate: date,
        sourceModule: "MM",
        sourceId: lc.lc_no,
        description: `${d.costType} — ${lc.lc_no}`,
        userId: req.user.id,
        lines: [
          { accountCode: "1350", debit: d.amount, text: `${d.costType} ${d.reference}`.trim() },
          { accountCode: account, credit: d.amount, text: lc.lc_no },
        ],
      });
      run("INSERT INTO lc_costs (lc_id, cost_type, cost_date, amount_cents, paid_from, reference, journal_id, created_by) VALUES (?,?,?,?,?,?,?,?)", [
        lc.id,
        d.costType,
        date,
        cents(d.amount),
        account,
        d.reference,
        posted.id,
        req.user.id,
      ]);
      audit(req, { action: "LC_COST", entityType: "lc", entityId: lc.lc_no, after: { ...d, journal: posted.docNumber } });
      return { journal: posted.docNumber };
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

mmRouter.post("/lcs/:id/allocate", requirePermission("mm.po.write"), (req, res) => {
  try {
    const result = tx((db) => allocateLc(db, Number(req.params.id), req.user.id));
    audit(req, { action: "LC_ALLOCATE", entityType: "lc", entityId: String(req.params.id), after: result });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

mmRouter.get("/purchase-orders", requirePermission("mm.po.read"), (_req, res) => {
  const pos = all(
    `SELECT p.*, v.code AS vendor_code, v.name AS vendor_name
     FROM purchase_orders p JOIN vendors v ON v.id = p.vendor_id
     ORDER BY p.id DESC`
  ).map((p) => {
    const lines = all(
      `SELECT l.*, m.sku, m.name AS material_name, m.uom
       FROM po_lines l JOIN materials m ON m.id = l.material_id
       WHERE l.po_id = ? ORDER BY l.line_no`,
      [p.id]
    ).map((l) => ({
      ...l,
      unitPrice: money(l.unit_price_cents),
      lineTotal: money(Math.round(l.qty * l.unit_price_cents)),
      qtyOpen: Math.max(0, l.qty - l.qty_received),
    }));
    return { ...p, lines, total: lines.reduce((s, l) => s + l.lineTotal, 0) };
  });
  res.json({ purchaseOrders: pos });
});

mmRouter.post("/purchase-orders", requirePermission("mm.po.write"), (req, res) => {
  const parsed = z
    .object({
      vendorId: z.number(),
      orderDate: z.string().optional(),
      notes: z.string().optional(),
      lines: z
        .array(
          z.object({
            materialId: z.number(),
            qty: z.number().positive(),
            unitPrice: z.number().nonnegative(),
          })
        )
        .min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const vendor = get("SELECT * FROM vendors WHERE id = ?", [parsed.data.vendorId]);
  if (!vendor) return res.status(400).json({ error: "Vendor not found" });
  const po = tx(() => {
    const no = nextNumber("PO");
    const totalCents = parsed.data.lines.reduce((s, l) => s + Math.round(l.qty * cents(l.unitPrice)), 0);
    const limitRow = get("SELECT value FROM app_settings WHERE key = 'approval_limit_bdt'");
    const needsApproval = totalCents >= Math.round(Number(limitRow?.value || 50000) * 100);
    const r = run(
      "INSERT INTO purchase_orders (po_number, vendor_id, order_date, status, notes, created_by, approval_status) VALUES (?, ?, ?, 'open', ?, ?, ?)",
      [no, vendor.id, parsed.data.orderDate || today(), parsed.data.notes || "", req.user.id, needsApproval ? "pending" : "approved"]
    );
    parsed.data.lines.forEach((line, i) => {
      run(
        "INSERT INTO po_lines (po_id, line_no, material_id, qty, unit_price_cents) VALUES (?, ?, ?, ?, ?)",
        [r.lastInsertRowid, i + 1, line.materialId, line.qty, cents(line.unitPrice)]
      );
    });
    if (needsApproval) {
      requestApprovalIfNeeded(req, {
        entityType: "purchase_order",
        entityId: Number(r.lastInsertRowid),
        entityNo: no,
        amountCents: totalCents,
      });
    }
    audit(req, { action: "CREATE", entityType: "purchase_order", entityId: no });
    return get("SELECT * FROM purchase_orders WHERE id = ?", [r.lastInsertRowid]);
  });
  res.status(201).json({ purchaseOrder: po });
});

mmRouter.post("/purchase-orders/:id/receive", requirePermission("mm.inventory.post"), (req, res) => {
  const parsed = z
    .object({
      storageLocationId: z.number(),
      lines: z.array(z.object({ poLineId: z.number(), qty: z.number().positive() })).min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const po = get("SELECT * FROM purchase_orders WHERE id = ?", [req.params.id]);
  if (!po) return res.status(404).json({ error: "PO not found" });
  if (po.status === "cancelled") return res.status(400).json({ error: "PO is cancelled" });
  if (po.approval_status === "pending") return res.status(400).json({ error: "PO awaiting approval" });
  if (po.approval_status === "rejected") return res.status(400).json({ error: "PO was rejected" });
  const loc = get("SELECT * FROM storage_locations WHERE id = ?", [parsed.data.storageLocationId]);
  if (!loc) return res.status(400).json({ error: "Storage location not found" });

  try {
    const result = tx((db) => {
      const movements = [];
      let totalCents = 0;
      const jeLines = [];

      for (const recv of parsed.data.lines) {
        const line = get("SELECT * FROM po_lines WHERE id = ? AND po_id = ?", [recv.poLineId, po.id]);
        if (!line) throw Object.assign(new Error("PO line not found"), { status: 400 });
        const open = line.qty - line.qty_received;
        if (recv.qty > open + 1e-9) throw Object.assign(new Error("Receive qty exceeds open qty"), { status: 400 });
        const lineCents = Math.round(recv.qty * line.unit_price_cents);
        totalCents += lineCents;
        const material = get("SELECT * FROM materials WHERE id = ?", [line.material_id]);
        const grNo = nextNumber("GR");
        jeLines.push({ accountCode: "1300", debit: money(lineCents), text: `${material.sku} ${recv.qty} ${material.uom}` });

        run("UPDATE po_lines SET qty_received = qty_received + ? WHERE id = ?", [recv.qty, line.id]);
        const inv = get("SELECT * FROM inventory WHERE material_id = ? AND storage_location_id = ?", [
          line.material_id,
          loc.id,
        ]);
        if (inv) run("UPDATE inventory SET qty_on_hand = qty_on_hand + ? WHERE id = ?", [recv.qty, inv.id]);
        else run("INSERT INTO inventory (material_id, storage_location_id, qty_on_hand) VALUES (?, ?, ?)", [line.material_id, loc.id, recv.qty]);

        movements.push({ grNo, materialId: line.material_id, qty: recv.qty, unitCost: line.unit_price_cents });
      }

      jeLines.push({ accountCode: "2100", credit: money(totalCents), text: `GR/IR ${po.po_number}` });
      const posted = postJournal(db, {
        date: today(),
        postingDate: today(),
        sourceModule: "MM",
        sourceId: po.po_number,
        description: `Goods receipt ${po.po_number}`,
        userId: req.user.id,
        lines: jeLines,
      });

      for (const m of movements) {
        run(
          `INSERT INTO goods_movements (movement_no, movement_type, material_id, storage_location_id, qty, unit_cost_cents, ref_type, ref_id, journal_id, created_by)
           VALUES (?, 'GR', ?, ?, ?, ?, 'PO', ?, ?, ?)`,
          [m.grNo, m.materialId, loc.id, m.qty, m.unitCost, String(po.id), posted.id, req.user.id]
        );
      }

      const lines = all("SELECT qty, qty_received FROM po_lines WHERE po_id = ?", [po.id]);
      const fully = lines.every((l) => l.qty_received + 1e-9 >= l.qty);
      run("UPDATE purchase_orders SET status = ? WHERE id = ?", [fully ? "received" : "partial", po.id]);
      audit(req, {
        action: "GOODS_RECEIPT",
        entityType: "purchase_order",
        entityId: po.po_number,
        after: { journal: posted.docNumber, qtyLines: parsed.data.lines.length },
      });
      return { journal: posted.docNumber, status: fully ? "received" : "partial" };
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

mmRouter.post("/goods-issue", requirePermission("mm.inventory.post"), (req, res) => {
  const parsed = z
    .object({
      materialId: z.number(),
      storageLocationId: z.number(),
      qty: z.number().positive(),
      reason: z.string().default("Consumption"),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const inv = get("SELECT * FROM inventory WHERE material_id = ? AND storage_location_id = ?", [
    parsed.data.materialId,
    parsed.data.storageLocationId,
  ]);
  if (!inv || inv.qty_on_hand < parsed.data.qty) return res.status(400).json({ error: "Insufficient stock" });
  const material = get("SELECT * FROM materials WHERE id = ?", [parsed.data.materialId]);
  const value = Math.round(parsed.data.qty * material.std_price_cents);
  try {
    const result = tx((db) => {
      const no = nextNumber("GI");
      const posted = postJournal(db, {
        date: today(),
        postingDate: today(),
        sourceModule: "MM",
        sourceId: no,
        description: `Goods issue ${material.sku} — ${parsed.data.reason}`,
        userId: req.user.id,
        lines: [
          { accountCode: "5000", debit: money(value), text: parsed.data.reason },
          { accountCode: "1300", credit: money(value), text: material.sku },
        ],
      });
      run("UPDATE inventory SET qty_on_hand = qty_on_hand - ? WHERE id = ?", [parsed.data.qty, inv.id]);
      run(
        `INSERT INTO goods_movements (movement_no, movement_type, material_id, storage_location_id, qty, unit_cost_cents, ref_type, ref_id, journal_id, created_by)
         VALUES (?, 'GI', ?, ?, ?, ?, 'GI', ?, ?, ?)`,
        [no, material.id, parsed.data.storageLocationId, parsed.data.qty, material.std_price_cents, parsed.data.reason, posted.id, req.user.id]
      );
      audit(req, { action: "GOODS_ISSUE", entityType: "material", entityId: material.sku, after: { journal: posted.docNumber, qty: parsed.data.qty } });
      return { movementNo: no, journal: posted.docNumber };
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

mmRouter.get("/movements", requirePermission("mm.inventory.read"), (_req, res) => {
  const movements = all(
    `SELECT g.*, m.sku, m.name AS material_name, m.uom, s.code AS location_code, h.doc_number AS journal_no
     FROM goods_movements g
     JOIN materials m ON m.id = g.material_id
     JOIN storage_locations s ON s.id = g.storage_location_id
     LEFT JOIN journal_headers h ON h.id = g.journal_id
     ORDER BY g.id DESC LIMIT 200`
  ).map((g) => ({ ...g, unitCost: money(g.unit_cost_cents), value: money(Math.round(g.qty * g.unit_cost_cents)) }));
  res.json({ movements });
});
