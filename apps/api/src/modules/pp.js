import { Router } from "express";
import { z } from "zod";
import { all, get, run, tx, cents, money, today, nextNumber } from "../db.js";
import { audit } from "../audit.js";
import { requirePermission } from "../auth.js";
import { postJournal } from "../posting.js";

export const ppRouter = Router();

ppRouter.get("/work-centers", requirePermission("pp.orders.read"), (_req, res) => {
  res.json({
    workCenters: all("SELECT * FROM work_centers ORDER BY code").map((w) => ({
      ...w,
      costPerHour: money(w.cost_per_hr_cents),
    })),
  });
});

ppRouter.post("/work-centers", requirePermission("pp.bom.write"), (req, res) => {
  const parsed = z
    .object({ code: z.string().min(1), name: z.string().min(1), capacityHrs: z.number().positive().default(8), costPerHour: z.number().nonnegative().default(0) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const r = run("INSERT INTO work_centers (code, name, capacity_hrs, cost_per_hr_cents) VALUES (?, ?, ?, ?)", [
      parsed.data.code,
      parsed.data.name,
      parsed.data.capacityHrs,
      cents(parsed.data.costPerHour),
    ]);
    const wc = get("SELECT * FROM work_centers WHERE id = ?", [r.lastInsertRowid]);
    audit(req, { action: "CREATE", entityType: "work_center", entityId: wc.code });
    res.status(201).json({ workCenter: { ...wc, costPerHour: money(wc.cost_per_hr_cents) } });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) return res.status(409).json({ error: "Code already exists" });
    throw err;
  }
});

function loadBom(id) {
  const bom = get(
    `SELECT b.*, m.sku AS parent_sku, m.name AS parent_name, m.uom AS parent_uom
     FROM boms b JOIN materials m ON m.id = b.parent_material_id WHERE b.id = ?`,
    [id]
  );
  if (!bom) return null;
  const components = all(
    `SELECT c.*, m.sku, m.name AS material_name, m.uom, m.std_price_cents
     FROM bom_components c JOIN materials m ON m.id = c.component_material_id
     WHERE c.bom_id = ?`,
    [id]
  ).map((c) => ({
    ...c,
    stdPrice: money(c.std_price_cents),
    extended: money(Math.round(c.qty * c.std_price_cents)),
  }));
  return {
    ...bom,
    components,
    unitCost: components.reduce((s, c) => s + c.extended, 0),
  };
}

ppRouter.get("/boms", requirePermission("pp.bom.read"), (_req, res) => {
  const ids = all("SELECT id FROM boms ORDER BY id");
  res.json({ boms: ids.map((r) => loadBom(r.id)) });
});

ppRouter.post("/boms", requirePermission("pp.bom.write"), (req, res) => {
  const parsed = z
    .object({
      parentMaterialId: z.number(),
      components: z.array(z.object({ materialId: z.number(), qty: z.number().positive(), scrapPct: z.number().nonnegative().default(0) })).min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const parent = get("SELECT * FROM materials WHERE id = ?", [parsed.data.parentMaterialId]);
  if (!parent) return res.status(400).json({ error: "Parent material not found" });
  try {
    const bom = tx(() => {
      const r = run("INSERT INTO boms (parent_material_id, version, status) VALUES (?, '1', 'active')", [parent.id]);
      for (const c of parsed.data.components) {
        run("INSERT INTO bom_components (bom_id, component_material_id, qty, scrap_pct) VALUES (?, ?, ?, ?)", [
          r.lastInsertRowid,
          c.materialId,
          c.qty,
          c.scrapPct || 0,
        ]);
      }
      audit(req, { action: "CREATE", entityType: "bom", entityId: parent.sku });
      return loadBom(r.lastInsertRowid);
    });
    res.status(201).json({ bom });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) return res.status(409).json({ error: "BOM already exists for this material" });
    throw err;
  }
});

function loadProd(id) {
  const p = get(
    `SELECT o.*, m.sku, m.name AS material_name, m.uom, w.code AS work_center_code, w.name AS work_center_name
     FROM production_orders o
     JOIN materials m ON m.id = o.material_id
     LEFT JOIN work_centers w ON w.id = o.work_center_id
     WHERE o.id = ?`,
    [id]
  );
  if (!p) return null;
  const bom = get("SELECT id FROM boms WHERE parent_material_id = ?", [p.material_id]);
  const components = bom
    ? all(
        `SELECT c.*, m.sku, m.name AS material_name, m.uom, m.std_price_cents
         FROM bom_components c JOIN materials m ON m.id = c.component_material_id WHERE c.bom_id = ?`,
        [bom.id]
      ).map((c) => ({
        ...c,
        required: c.qty * (1 + c.scrap_pct / 100) * (p.qty_planned - p.qty_produced),
        stdPrice: money(c.std_price_cents),
      }))
    : [];
  return { ...p, components };
}

ppRouter.get("/orders", requirePermission("pp.orders.read"), (_req, res) => {
  const ids = all("SELECT id FROM production_orders ORDER BY id DESC");
  res.json({ productionOrders: ids.map((r) => loadProd(r.id)) });
});

ppRouter.post("/orders", requirePermission("pp.orders.write"), (req, res) => {
  const parsed = z
    .object({
      materialId: z.number(),
      workCenterId: z.number().optional(),
      qtyPlanned: z.number().positive(),
      dueDate: z.string().optional(),
      notes: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const mat = get("SELECT * FROM materials WHERE id = ?", [parsed.data.materialId]);
  if (!mat) return res.status(400).json({ error: "Material not found" });
  const bom = get("SELECT id FROM boms WHERE parent_material_id = ? AND status = 'active'", [mat.id]);
  if (!bom) return res.status(400).json({ error: "No active BOM for this finished material" });
  const no = nextNumber("PROD");
  const r = run(
    `INSERT INTO production_orders (po_number, material_id, work_center_id, qty_planned, status, start_date, due_date, notes, created_by)
     VALUES (?, ?, ?, ?, 'released', ?, ?, ?, ?)`,
    [no, mat.id, parsed.data.workCenterId || null, parsed.data.qtyPlanned, today(), parsed.data.dueDate || null, parsed.data.notes || "", req.user.id]
  );
  audit(req, { action: "CREATE", entityType: "production_order", entityId: no });
  res.status(201).json({ productionOrder: loadProd(r.lastInsertRowid) });
});

ppRouter.post("/orders/:id/confirm", requirePermission("pp.orders.write"), (req, res) => {
  const parsed = z
    .object({
      qty: z.number().positive(),
      storageLocationId: z.number(),
      componentLocationId: z.number().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const order = loadProd(req.params.id);
  if (!order) return res.status(404).json({ error: "Production order not found" });
  if (order.status === "closed") return res.status(400).json({ error: "Order is closed" });
  const remaining = order.qty_planned - order.qty_produced;
  if (parsed.data.qty > remaining + 1e-9) return res.status(400).json({ error: "Qty exceeds remaining plan" });
  const fgLoc = get("SELECT * FROM storage_locations WHERE id = ?", [parsed.data.storageLocationId]);
  const compLocId = parsed.data.componentLocationId || parsed.data.storageLocationId;
  const compLoc = get("SELECT * FROM storage_locations WHERE id = ?", [compLocId]);
  if (!fgLoc || !compLoc) return res.status(400).json({ error: "Storage location not found" });

  try {
    const result = tx((db) => {
      let materialCost = 0;
      const bom = get("SELECT id FROM boms WHERE parent_material_id = ?", [order.material_id]);
      const comps = all("SELECT * FROM bom_components WHERE bom_id = ?", [bom.id]);

      for (const c of comps) {
        const need = c.qty * (1 + c.scrap_pct / 100) * parsed.data.qty;
        const mat = get("SELECT * FROM materials WHERE id = ?", [c.component_material_id]);
        const inv = get("SELECT * FROM inventory WHERE material_id = ? AND storage_location_id = ?", [c.component_material_id, compLoc.id]);
        if (!inv || inv.qty_on_hand < need) {
          throw Object.assign(new Error(`Insufficient ${mat.sku}: need ${need}, have ${inv?.qty_on_hand || 0}`), { status: 400 });
        }
        const val = Math.round(need * mat.std_price_cents);
        materialCost += val;
        run("UPDATE inventory SET qty_on_hand = qty_on_hand - ? WHERE id = ?", [need, inv.id]);
        const giNo = nextNumber("GI");
        run(
          `INSERT INTO goods_movements (movement_no, movement_type, material_id, storage_location_id, qty, unit_cost_cents, ref_type, ref_id, created_by)
           VALUES (?, 'GI', ?, ?, ?, ?, 'PROD', ?, ?)`,
          [giNo, c.component_material_id, compLoc.id, need, mat.std_price_cents, order.po_number, req.user.id]
        );
      }

      const parent = get("SELECT * FROM materials WHERE id = ?", [order.material_id]);
      const fgInv = get("SELECT * FROM inventory WHERE material_id = ? AND storage_location_id = ?", [order.material_id, fgLoc.id]);
      if (fgInv) run("UPDATE inventory SET qty_on_hand = qty_on_hand + ? WHERE id = ?", [parsed.data.qty, fgInv.id]);
      else run("INSERT INTO inventory (material_id, storage_location_id, qty_on_hand) VALUES (?, ?, ?)", [order.material_id, fgLoc.id, parsed.data.qty]);

      // Revalue FG at BOM material cost for this confirmation
      if (parsed.data.qty > 0) {
        const unit = Math.round(materialCost / parsed.data.qty);
        run("UPDATE materials SET std_price_cents = ? WHERE id = ?", [unit || parent.std_price_cents, parent.id]);
      }

      const grNo = nextNumber("GR");
      run(
        `INSERT INTO goods_movements (movement_no, movement_type, material_id, storage_location_id, qty, unit_cost_cents, ref_type, ref_id, created_by)
         VALUES (?, 'GR', ?, ?, ?, ?, 'PROD', ?, ?)`,
        [grNo, order.material_id, fgLoc.id, parsed.data.qty, Math.round(materialCost / parsed.data.qty), order.po_number, req.user.id]
      );

      const posted = postJournal(db, {
        date: today(),
        postingDate: today(),
        sourceModule: "PP",
        sourceId: order.po_number,
        description: `Production confirm ${order.po_number} — ${parsed.data.qty} ${parent.uom}`,
        userId: req.user.id,
        lines: [
          { accountCode: "1300", debit: money(materialCost), text: `FG receipt ${parent.sku}` },
          { accountCode: "1300", credit: money(materialCost), text: `RM issue for ${order.po_number}` },
        ],
      });

      run(
        `UPDATE goods_movements SET journal_id = ? WHERE ref_type = 'PROD' AND ref_id = ? AND journal_id IS NULL`,
        [posted.id, order.po_number]
      );

      const newQty = order.qty_produced + parsed.data.qty;
      const closed = newQty + 1e-9 >= order.qty_planned;
      run("UPDATE production_orders SET qty_produced = ?, status = ? WHERE id = ?", [
        newQty,
        closed ? "closed" : "in_progress",
        order.id,
      ]);
      audit(req, {
        action: "CONFIRM",
        entityType: "production_order",
        entityId: order.po_number,
        after: { qty: parsed.data.qty, journal: posted.docNumber, materialCost: money(materialCost) },
      });
      return { journal: posted.docNumber, materialCost: money(materialCost), status: closed ? "closed" : "in_progress" };
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});
