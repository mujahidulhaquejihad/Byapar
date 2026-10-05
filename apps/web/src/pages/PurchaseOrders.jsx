import { useMemo, useState } from "react";
import { api, money } from "../api.js";
import { Badge, Button, Field, Modal, Page, Table, useApi } from "../ui.jsx";

export default function PurchaseOrders() {
  const { data, error, loading, reload, setError } = useApi(() => api("/mm/purchase-orders"));
  const vendors = useApi(() => api("/fico/vendors"));
  const materials = useApi(() => api("/mm/materials"));
  const inventory = useApi(() => api("/mm/inventory"));
  const [open, setOpen] = useState(false);
  const [recv, setRecv] = useState(null);
  const [form, setForm] = useState({
    vendorId: "",
    notes: "",
    lines: [{ materialId: "", qty: 10, unitPrice: 100 }],
  });
  const [recvForm, setRecvForm] = useState({ storageLocationId: "", qtys: {} });

  const locs = inventory.data?.locations || [];

  async function create() {
    try {
      await api("/mm/purchase-orders", {
        method: "POST",
        body: {
          vendorId: Number(form.vendorId),
          notes: form.notes,
          lines: form.lines.map((l) => ({ materialId: Number(l.materialId), qty: Number(l.qty), unitPrice: Number(l.unitPrice) })),
        },
      });
      setOpen(false);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  async function doReceive() {
    try {
      const lines = Object.entries(recvForm.qtys)
        .map(([poLineId, qty]) => ({ poLineId: Number(poLineId), qty: Number(qty) }))
        .filter((l) => l.qty > 0);
      await api(`/mm/purchase-orders/${recv.id}/receive`, {
        method: "POST",
        body: { storageLocationId: Number(recvForm.storageLocationId), lines },
      });
      setRecv(null);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  const flat = useMemo(() => data?.purchaseOrders || [], [data]);

  if (loading) return <p className="muted">Loading purchase orders…</p>;
  return (
    <Page
      title="Purchase orders"
      subtitle="Goods receipt increases inventory and posts Dr Inventory / Cr GR/IR — the same posting service used by Finance."
      actions={<Button onClick={() => setOpen(true)}>New purchase order</Button>}
    >
      {error ? <div className="err">{error}</div> : null}
      {flat.map((po) => (
        <div className="doc-card" key={po.id}>
          <div className="doc-h">
            <div>
              <div className="doc-title">
                {po.po_number} · {po.vendor_name}
              </div>
              <div className="doc-meta">{money(po.total)}</div>
            </div>
            <span className="row-actions">
              <Badge kind={po.status}>{po.status}</Badge>
              {po.status !== "received" && po.status !== "cancelled" ? (
                <Button
                  kind="ghost"
                  onClick={() => {
                    setRecv(po);
                    setRecvForm({
                      storageLocationId: String(locs[0]?.id || ""),
                      qtys: Object.fromEntries(po.lines.map((l) => [l.id, l.qtyOpen])),
                    });
                  }}
                >
                  Receive goods
                </Button>
              ) : null}
            </span>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Material</th>
                <th className="num">Qty</th>
                <th className="num">Received</th>
                <th className="num">Price</th>
                <th className="num">Line total</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.sku}</td>
                  <td>{l.material_name}</td>
                  <td className="num">
                    {l.qty} {l.uom}
                  </td>
                  <td className="num">{l.qty_received}</td>
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
          title="Create purchase order"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create}>Save PO</Button>
            </>
          }
        >
          <div className="form two">
            <Field label="Vendor">
              <select value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}>
                <option value="">Select…</option>
                {(vendors.data?.vendors || []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Notes">
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          {form.lines.map((line, i) => (
            <div className="form two" key={i} style={{ marginTop: 10 }}>
              <Field label="Material">
                <select
                  value={line.materialId}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    const mat = (materials.data?.materials || []).find((m) => String(m.id) === e.target.value);
                    lines[i] = { ...line, materialId: e.target.value, unitPrice: mat?.stdPrice ?? line.unitPrice };
                    setForm({ ...form, lines });
                  }}
                >
                  <option value="">Select…</option>
                  {(materials.data?.materials || []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.sku} — {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Qty">
                <input
                  type="number"
                  value={line.qty}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...line, qty: e.target.value };
                    setForm({ ...form, lines });
                  }}
                />
              </Field>
              <Field label="Unit price">
                <input
                  type="number"
                  value={line.unitPrice}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...line, unitPrice: e.target.value };
                    setForm({ ...form, lines });
                  }}
                />
              </Field>
            </div>
          ))}
          <div style={{ marginTop: 10 }}>
            <Button kind="ghost" onClick={() => setForm({ ...form, lines: [...form.lines, { materialId: "", qty: 1, unitPrice: 0 }] })}>
              Add line
            </Button>
          </div>
        </Modal>
      ) : null}

      {recv ? (
        <Modal
          title={`Goods receipt ${recv.po_number}`}
          onClose={() => setRecv(null)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setRecv(null)}>
                Cancel
              </Button>
              <Button onClick={doReceive}>Post GR to inventory + GL</Button>
            </>
          }
        >
          <div className="form">
            <Field label="Storage location">
              <select value={recvForm.storageLocationId} onChange={(e) => setRecvForm({ ...recvForm, storageLocationId: e.target.value })}>
                {locs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.warehouse_code}-{l.code} {l.name}
                  </option>
                ))}
              </select>
            </Field>
            {recv.lines.map((l) => (
              <Field key={l.id} label={`${l.sku} — open ${l.qtyOpen} ${l.uom}`}>
                <input
                  type="number"
                  value={recvForm.qtys[l.id] ?? 0}
                  onChange={(e) => setRecvForm({ ...recvForm, qtys: { ...recvForm.qtys, [l.id]: e.target.value } })}
                />
              </Field>
            ))}
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}
