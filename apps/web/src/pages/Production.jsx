import { useState } from "react";
import { api } from "../api.js";
import { Badge, Button, Field, Modal, Page, useApi } from "../ui.jsx";

export default function Production() {
  const { data, error, loading, reload, setError } = useApi(() => api("/pp/orders"));
  const materials = useApi(() => api("/mm/materials"));
  const centers = useApi(() => api("/pp/work-centers"));
  const inventory = useApi(() => api("/mm/inventory"));
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [form, setForm] = useState({ materialId: "", workCenterId: "", qtyPlanned: 10, dueDate: "", notes: "" });
  const [cf, setCf] = useState({ qty: 1, storageLocationId: "", componentLocationId: "" });

  async function create() {
    try {
      await api("/pp/orders", {
        method: "POST",
        body: {
          materialId: Number(form.materialId),
          workCenterId: form.workCenterId ? Number(form.workCenterId) : undefined,
          qtyPlanned: Number(form.qtyPlanned),
          dueDate: form.dueDate || undefined,
          notes: form.notes,
        },
      });
      setOpen(false);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  async function doConfirm() {
    try {
      await api(`/pp/orders/${confirm.id}/confirm`, {
        method: "POST",
        body: {
          qty: Number(cf.qty),
          storageLocationId: Number(cf.storageLocationId),
          componentLocationId: Number(cf.componentLocationId || cf.storageLocationId),
        },
      });
      setConfirm(null);
      reload();
      inventory.reload();
    } catch (e) {
      setError(e.message);
    }
  }

  const locs = inventory.data?.locations || [];

  if (loading) return <p className="muted">Loading production…</p>;
  return (
    <Page
      title="Production orders"
      subtitle="Confirm issues components from RM and receipts finished goods. Inventory reclass posts through the GL."
      actions={<Button onClick={() => setOpen(true)}>Release order</Button>}
    >
      {error ? <div className="err">{error}</div> : null}
      {(data?.productionOrders || []).map((o) => (
        <div className="doc-card" key={o.id}>
          <div className="doc-h">
            <div>
              <div className="doc-title">
                {o.po_number} · {o.sku} — {o.material_name}
              </div>
              <div className="doc-meta">
                {o.work_center_code || "—"} · planned {o.qty_planned} · produced {o.qty_produced} {o.uom}
              </div>
            </div>
            <div className="row-actions">
              <Badge kind={o.status}>{o.status}</Badge>
              {o.status !== "closed" ? (
                <Button
                  kind="ghost"
                  onClick={() => {
                    setConfirm(o);
                    setCf({
                      qty: Math.min(5, o.qty_planned - o.qty_produced),
                      storageLocationId: String(locs.find((l) => l.code === "FG01")?.id || ""),
                      componentLocationId: String(locs.find((l) => l.code === "RM01")?.id || ""),
                    });
                  }}
                >
                  Confirm yield
                </Button>
              ) : null}
            </div>
          </div>
          {o.components?.length ? (
            <table className="data">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Name</th>
                  <th className="num">Still required</th>
                </tr>
              </thead>
              <tbody>
                {o.components.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.sku}</td>
                    <td>{c.material_name}</td>
                    <td className="num">
                      {Number(c.required).toFixed(2)} {c.uom}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ))}

      {open ? (
        <Modal
          title="Release production order"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create}>Release</Button>
            </>
          }
        >
          <div className="form two">
            <Field label="Finished material">
              <select value={form.materialId} onChange={(e) => setForm({ ...form, materialId: e.target.value })}>
                <option value="">Select…</option>
                {(materials.data?.materials || [])
                  .filter((m) => m.type === "finished")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.sku}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Work center">
              <select value={form.workCenterId} onChange={(e) => setForm({ ...form, workCenterId: e.target.value })}>
                <option value="">Optional…</option>
                {(centers.data?.workCenters || []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Qty planned">
              <input type="number" value={form.qtyPlanned} onChange={(e) => setForm({ ...form, qtyPlanned: e.target.value })} />
            </Field>
            <Field label="Due date">
              <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </Field>
          </div>
        </Modal>
      ) : null}

      {confirm ? (
        <Modal
          title={`Confirm ${confirm.po_number}`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button onClick={doConfirm}>Post confirmation</Button>
            </>
          }
        >
          <div className="form two">
            <Field label="Qty to produce">
              <input type="number" value={cf.qty} onChange={(e) => setCf({ ...cf, qty: e.target.value })} />
            </Field>
            <Field label="FG receipt location">
              <select value={cf.storageLocationId} onChange={(e) => setCf({ ...cf, storageLocationId: e.target.value })}>
                {locs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Component issue location" full>
              <select value={cf.componentLocationId} onChange={(e) => setCf({ ...cf, componentLocationId: e.target.value })}>
                {locs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} {l.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
            Estimated material draw at BOM qty × confirm qty. Std cost of FG updates to actual BOM cost.
          </p>
        </Modal>
      ) : null}
    </Page>
  );
}
