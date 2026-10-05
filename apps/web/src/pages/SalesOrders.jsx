import { useMemo, useState } from "react";
import { api, money } from "../api.js";
import { Badge, Button, Field, Modal, Page, useApi } from "../ui.jsx";

/** Material / qty / price rows; picking a material fills the customer's price-list price. */
export function SalesLines({ customerId, materials, lines, onChange }) {
  const set = (i, patch) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  async function pickMaterial(i, materialId) {
    set(i, { materialId });
    if (!materialId) return;
    const p = await api(`/sd/price?customerId=${customerId || 0}&materialId=${materialId}`).catch(() => null);
    if (p) onChange(lines.map((l, j) => (j === i ? { ...l, materialId, unitPrice: p.unitPrice, priceSource: p.source } : l)));
  }
  return (
    <>
      {lines.map((line, i) => (
        <div className="form two" key={i} style={{ marginTop: 10 }}>
          <Field label={`Material ${i + 1}`}>
            <select value={line.materialId} onChange={(e) => pickMaterial(i, e.target.value)}>
              <option value="">Select…</option>
              {(materials || [])
                .filter((m) => m.type === "finished")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.sku} — {m.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Qty">
            <input type="number" value={line.qty} onChange={(e) => set(i, { qty: e.target.value })} />
          </Field>
          <Field label={line.priceSource === "price_list" ? "Unit price (customer price list)" : "Unit price"}>
            <input type="number" value={line.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value, priceSource: "" })} />
          </Field>
          {lines.length > 1 ? (
            <Field label="&nbsp;">
              <Button kind="ghost" onClick={() => onChange(lines.filter((_, j) => j !== i))}>
                Remove line
              </Button>
            </Field>
          ) : null}
        </div>
      ))}
      <div style={{ marginTop: 10 }}>
        <Button kind="ghost" onClick={() => onChange([...lines, { materialId: "", qty: 1, unitPrice: 0 }])}>
          Add line
        </Button>
      </div>
    </>
  );
}

export default function SalesOrders() {
  const { data, error, loading, reload, setError } = useApi(() => api("/sd/orders"));
  const customers = useApi(() => api("/fico/customers"));
  const materials = useApi(() => api("/mm/materials"));
  const inventory = useApi(() => api("/mm/inventory"));
  const [open, setOpen] = useState(false);
  const [deliver, setDeliver] = useState(null);
  const [form, setForm] = useState({
    customerId: "",
    notes: "",
    lines: [{ materialId: "", qty: 5, unitPrice: 14500 }],
  });
  const [delForm, setDelForm] = useState({ storageLocationId: "", qtys: {} });
  const locs = useMemo(() => (inventory.data?.locations || []).filter((l) => l.code === "FG01" || true), [inventory.data]);

  async function create() {
    try {
      const r = await api("/sd/orders", {
        method: "POST",
        body: {
          customerId: Number(form.customerId),
          notes: form.notes,
          lines: form.lines.map((l) => ({
            materialId: Number(l.materialId),
            qty: Number(l.qty),
            unitPrice: Number(l.unitPrice),
          })),
        },
      });
      setOpen(false);
      if (r.salesOrder.overCredit) setError(`${r.salesOrder.so_number} saved, but the customer is over their credit limit — it waits in Approvals.`);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  async function doDeliver() {
    try {
      const lines = Object.entries(delForm.qtys)
        .map(([soLineId, qty]) => ({ soLineId: Number(soLineId), qty: Number(qty) }))
        .filter((l) => l.qty > 0);
      await api(`/sd/orders/${deliver.id}/deliver`, {
        method: "POST",
        body: { storageLocationId: Number(delForm.storageLocationId), lines },
      });
      setDeliver(null);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  async function bill(id) {
    try {
      await api(`/sd/orders/${id}/bill`, { method: "POST" });
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <p className="muted">Loading sales orders…</p>;
  return (
    <Page
      title="Sales orders"
      subtitle="Order → deliver (COGS) → Mushak / tax invoice (AR + 15% VAT). All amounts in ৳."
      actions={<Button onClick={() => setOpen(true)}>New sales order</Button>}
    >
      {error ? <div className="err">{error}</div> : null}
      {(data?.salesOrders || []).map((so) => (
        <div className="doc-card" key={so.id}>
          <div className="doc-h">
            <div>
              <div className="doc-title">
                {so.so_number} · {so.customer_name}
              </div>
              <div className="doc-meta">
                {so.order_date} · {money(so.total)}
              </div>
            </div>
            <div className="row-actions">
              <Badge kind={so.status}>{so.status}</Badge>
              {so.approval_status !== "approved" ? <Badge kind={so.approval_status}>approval {so.approval_status}</Badge> : null}
              {so.lines.some((l) => l.qtyOpen > 0) ? (
                <Button
                  kind="ghost"
                  onClick={() => {
                    setDeliver(so);
                    setDelForm({
                      storageLocationId: String(locs.find((l) => l.code === "FG01")?.id || locs[0]?.id || ""),
                      qtys: Object.fromEntries(so.lines.map((l) => [l.id, l.qtyOpen])),
                    });
                  }}
                >
                  Deliver
                </Button>
              ) : null}
              {so.lines.some((l) => l.qtyBillable > 0) ? (
                <Button kind="ghost" onClick={() => bill(so.id)}>
                  Bill delivered
                </Button>
              ) : null}
            </div>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Material</th>
                <th className="num">Ordered</th>
                <th className="num">Delivered</th>
                <th className="num">Billed</th>
                <th className="num">Price</th>
                <th className="num">Line</th>
              </tr>
            </thead>
            <tbody>
              {so.lines.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.sku}</td>
                  <td>{l.material_name}</td>
                  <td className="num">
                    {l.qty} {l.uom}
                  </td>
                  <td className="num">{l.qty_delivered}</td>
                  <td className="num">{l.qty_billed}</td>
                  <td className="num">{money(l.unitPrice)}</td>
                  <td className="num">{money(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {open ? (
        <Modal
          title="Create sales order"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create}>Save order</Button>
            </>
          }
        >
          <div className="form two">
            <Field label="Customer">
              <select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                <option value="">Select…</option>
                {(customers.data?.customers || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Notes">
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <SalesLines customerId={form.customerId} materials={materials.data?.materials} lines={form.lines} onChange={(lines) => setForm({ ...form, lines })} />
        </Modal>
      ) : null}

      {deliver ? (
        <Modal
          title={`Deliver ${deliver.so_number}`}
          onClose={() => setDeliver(null)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setDeliver(null)}>
                Cancel
              </Button>
              <Button onClick={doDeliver}>Post delivery</Button>
            </>
          }
        >
          <div className="form">
            <Field label="Ship-from location">
              <select value={delForm.storageLocationId} onChange={(e) => setDelForm({ ...delForm, storageLocationId: e.target.value })}>
                {locs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.warehouse_code}-{l.code} {l.name}
                  </option>
                ))}
              </select>
            </Field>
            {deliver.lines.map((l) => (
              <Field key={l.id} label={`${l.sku} — open ${l.qtyOpen} ${l.uom}`}>
                <input
                  type="number"
                  value={delForm.qtys[l.id] ?? 0}
                  onChange={(e) => setDelForm({ ...delForm, qtys: { ...delForm.qtys, [l.id]: e.target.value } })}
                />
              </Field>
            ))}
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}
