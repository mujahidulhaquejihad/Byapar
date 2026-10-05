import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, money } from "../api.js";
import { Badge, Button, Field, Modal, Page, Table, useApi } from "../ui.jsx";
import { SalesLines } from "./SalesOrders.jsx";

const blankQuote = () => ({ customerId: "", validUntil: "", notes: "", lines: [{ materialId: "", qty: 1, unitPrice: 0 }] });

export default function Quotations() {
  const navigate = useNavigate();
  const { data, error, loading, reload, setError } = useApi(() => api("/sd/quotations"));
  const prices = useApi(() => api("/sd/price-lists"));
  const customers = useApi(() => api("/fico/customers"));
  const materials = useApi(() => api("/mm/materials"));
  const [form, setForm] = useState(null);
  const [pl, setPl] = useState({ customerId: "", materialId: "", unitPrice: "", discountPct: 0 });

  async function act(fn) {
    try {
      await fn();
      reload();
      prices.reload();
    } catch (e) {
      setError(e.message);
    }
  }

  const saveQuote = () =>
    act(async () => {
      await api("/sd/quotations", {
        method: "POST",
        body: {
          customerId: Number(form.customerId),
          validUntil: form.validUntil || undefined,
          notes: form.notes,
          lines: form.lines.map((l) => ({ materialId: Number(l.materialId), qty: Number(l.qty), unitPrice: Number(l.unitPrice) })),
        },
      });
      setForm(null);
    });

  const convert = (q) =>
    act(async () => {
      await api(`/sd/quotations/${q.id}/convert`, { method: "POST" });
      navigate("/sales-orders");
    });

  const savePrice = () =>
    act(() =>
      api("/sd/price-lists", {
        method: "POST",
        body: { customerId: Number(pl.customerId), materialId: Number(pl.materialId), unitPrice: Number(pl.unitPrice), discountPct: Number(pl.discountPct) || 0 },
      })
    );

  if (loading) return <p className="muted">Loading quotations…</p>;
  const today = new Date().toISOString().slice(0, 10);
  const custOpts = (customers.data?.customers || []).map((c) => (
    <option key={c.id} value={c.id}>
      {c.name}
    </option>
  ));
  return (
    <Page
      title="Quotations & price lists"
      subtitle="Quote the customer, convert to a sales order when accepted. Price-list prices fill in automatically on quotes and orders."
      actions={<Button onClick={() => setForm(blankQuote())}>New quotation</Button>}
    >
      {error ? <div className="err">{error}</div> : null}
      <Table
        columns={[
          { key: "quote_no", label: "Quote", mono: true },
          { key: "customer_name", label: "Customer" },
          { key: "quote_date", label: "Date" },
          { key: "valid_until", label: "Valid until" },
          { key: "items", label: "Items", render: (q) => q.lines.map((l) => `${l.sku} × ${l.qty}`).join(", ") },
          { key: "total", label: "Total (ex VAT)", num: true, render: (q) => money(q.total) },
          {
            key: "status",
            label: "Status",
            render: (q) => {
              const s = q.status === "open" && q.valid_until < today ? "expired" : q.status;
              return <Badge kind={s}>{q.so_number ? `${s} → ${q.so_number}` : s}</Badge>;
            },
          },
          {
            key: "act",
            label: "",
            render: (q) => (
              <span className="row-actions">
                <Link className="btn ghost" to={`/print/quotation/${q.id}`}>
                  Print
                </Link>
                {q.status === "open" ? (
                  <>
                    {q.valid_until >= today ? <Button onClick={() => convert(q)}>Convert to SO</Button> : null}
                    <Button kind="ghost" onClick={() => act(() => api(`/sd/quotations/${q.id}/cancel`, { method: "POST" }))}>
                      Cancel
                    </Button>
                  </>
                ) : null}
              </span>
            ),
          },
        ]}
        rows={data?.quotations}
        empty="No quotations yet"
      />

      <h3>Customer price lists</h3>
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-b form two">
          <Field label="Customer">
            <select value={pl.customerId} onChange={(e) => setPl({ ...pl, customerId: e.target.value })}>
              <option value="">Select…</option>
              {custOpts}
            </select>
          </Field>
          <Field label="Material">
            <select value={pl.materialId} onChange={(e) => setPl({ ...pl, materialId: e.target.value })}>
              <option value="">Select…</option>
              {(materials.data?.materials || [])
                .filter((m) => m.type === "finished")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.sku} — {m.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="List price (৳)">
            <input type="number" value={pl.unitPrice} onChange={(e) => setPl({ ...pl, unitPrice: e.target.value })} />
          </Field>
          <Field label="Discount %">
            <input type="number" value={pl.discountPct} onChange={(e) => setPl({ ...pl, discountPct: e.target.value })} />
          </Field>
          <Button onClick={savePrice}>Save price</Button>
        </div>
      </div>
      <Table
        columns={[
          { key: "customer_name", label: "Customer" },
          { key: "sku", label: "SKU", mono: true },
          { key: "material_name", label: "Material" },
          { key: "unitPrice", label: "List price", num: true, render: (r) => money(r.unitPrice) },
          { key: "discount_pct", label: "Disc %", num: true },
          { key: "netPrice", label: "Net price", num: true, render: (r) => money(r.netPrice) },
          {
            key: "act",
            label: "",
            render: (r) => (
              <Button kind="ghost" onClick={() => act(() => api(`/sd/price-lists/${r.id}`, { method: "DELETE" }))}>
                Remove
              </Button>
            ),
          },
        ]}
        rows={prices.data?.priceLists}
        empty="No customer-specific prices — standard price + 75% is used"
      />

      {form ? (
        <Modal
          title="New quotation"
          onClose={() => setForm(null)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setForm(null)}>
                Cancel
              </Button>
              <Button onClick={saveQuote}>Save quotation</Button>
            </>
          }
        >
          <div className="form two">
            <Field label="Customer">
              <select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                <option value="">Select…</option>
                {custOpts}
              </select>
            </Field>
            <Field label="Valid until (default 15 days)">
              <input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
            </Field>
            <Field label="Notes" full>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <SalesLines customerId={form.customerId} materials={materials.data?.materials} lines={form.lines} onChange={(lines) => setForm({ ...form, lines })} />
        </Modal>
      ) : null}
    </Page>
  );
}
