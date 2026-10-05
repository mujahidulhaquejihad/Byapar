import { useState } from "react";
import { Link } from "react-router-dom";
import { api, money } from "../api.js";
import { Badge, Button, CashAccountSelect, Field, Modal, Page, Table, useApi } from "../ui.jsx";

/** Optional goods-return part of a credit/debit note: tick to move stock, then pick material, qty, location. */
export function ReturnFields({ value, onChange, label }) {
  const materials = useApi(() => api("/mm/materials"));
  const inventory = useApi(() => api("/mm/inventory"));
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <>
      <Field label=" " full>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500 }}>
          <input type="checkbox" checked={!!value.on} onChange={(e) => set({ on: e.target.checked })} style={{ width: "auto" }} />
          {label}
        </label>
      </Field>
      {value.on ? (
        <>
          {materials.error ? <div className="err">{materials.error}</div> : null}
          <Field label="Material">
            <select value={value.materialId} onChange={(e) => set({ materialId: e.target.value })}>
              <option value="">Select…</option>
              {(materials.data?.materials || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.sku} — {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Qty">
            <input type="number" value={value.qty} onChange={(e) => set({ qty: e.target.value })} />
          </Field>
          <Field label="Store location">
            <select value={value.storageLocationId} onChange={(e) => set({ storageLocationId: e.target.value })}>
              <option value="">Select…</option>
              {(inventory.data?.locations || []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.warehouse_code}-{l.code} {l.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : null}
    </>
  );
}

export const stockBody = (r) => (r?.on ? { stock: { materialId: Number(r.materialId), qty: Number(r.qty), storageLocationId: Number(r.storageLocationId) } } : {});

export default function AR() {
  const { data, error, loading, reload, setError } = useApi(() => api("/fico/ar-invoices"));
  const customers = useApi(() => api("/fico/customers"));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    customerId: "",
    invoiceDate: new Date().toISOString().slice(0, 10),
    amount: 11500,
    tax: 1500,
    description: "Customer tax invoice (Mushak)",
  });

  async function create() {
    try {
      await api("/fico/ar-invoices", {
        method: "POST",
        body: { ...form, customerId: Number(form.customerId), amount: Number(form.amount), tax: Number(form.tax) },
      });
      setOpen(false);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  // act = { inv, mode: "receive" | "credit", amount, reason }
  const [act, setAct] = useState(null);

  async function submitAct() {
    try {
      const path = act.mode === "receive" ? "receive" : "credit-note";
      await api(`/fico/ar-invoices/${act.inv.id}/${path}`, {
        method: "POST",
        body:
          act.mode === "receive"
            ? { amount: Number(act.amount), accountCode: act.accountCode, fee: Number(act.fee) || 0 }
            : { amount: Number(act.amount), reason: act.reason, ...stockBody(act.ret) },
      });
      setAct(null);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <p className="muted">Loading AR…</p>;
  return (
    <Page title="Accounts receivable" subtitle="Tax invoices in ৳ — Dr AR, Cr Revenue + Output VAT 15%. Receipt clears AR into DBBL." actions={<Button onClick={() => setOpen(true)}>New AR invoice</Button>}>
      {error ? <div className="err">{error}</div> : null}
      <Table
        columns={[
          { key: "invoice_no", label: "Invoice" },
          { key: "customer_name", label: "Customer" },
          { key: "invoice_date", label: "Date" },
          { key: "due_date", label: "Due" },
          { key: "amount", label: "Amount", num: true, render: (r) => money(r.amount) },
          { key: "outstanding", label: "Outstanding", num: true, render: (r) => money(r.outstanding) },
          { key: "journal_no", label: "GL doc" },
          { key: "status", label: "Status", render: (r) => <Badge kind={r.status}>{r.status}</Badge> },
          {
            key: "act",
            label: "",
            render: (r) => (
              <span className="row-actions">
                <Link className="btn ghost" to={`/print/invoice/${r.id}`}>
                  Mushak
                </Link>
                <Link className="btn ghost" to={`/print/statement/${r.customer_id}`}>
                  Statement
                </Link>
                {r.outstanding > 0 ? (
                  <>
                    <Button kind="ghost" onClick={() => setAct({ inv: r, mode: "receive", amount: r.outstanding, reason: "", accountCode: "1100", fee: 0 })}>
                      Receive
                    </Button>
                    <Button kind="ghost" onClick={() => setAct({ inv: r, mode: "credit", amount: r.outstanding, reason: "Goods returned", ret: { on: false, materialId: "", qty: 1, storageLocationId: "" } })}>
                      Credit note
                    </Button>
                  </>
                ) : null}
              </span>
            ),
          },
        ]}
        rows={data?.invoices || []}
      />
      {act ? (
        <Modal
          title={`${act.mode === "receive" ? "Receive payment" : "Credit note"} — ${act.inv.invoice_no}`}
          onClose={() => setAct(null)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setAct(null)}>
                Cancel
              </Button>
              <Button onClick={submitAct}>Post to GL</Button>
            </>
          }
        >
          <p className="muted" style={{ marginTop: 0 }}>
            {act.inv.customer_name} · outstanding {money(act.inv.outstanding)}
            {act.mode === "credit" ? " · VAT is reversed in proportion to the invoice" : ""}
          </p>
          <div className="form two">
            <Field label="Amount (৳, incl. VAT)">
              <input type="number" value={act.amount} onChange={(e) => setAct({ ...act, amount: e.target.value })} />
            </Field>
            {act.mode === "credit" ? (
              <>
                <Field label="Reason">
                  <input value={act.reason} onChange={(e) => setAct({ ...act, reason: e.target.value })} />
                </Field>
                <ReturnFields value={act.ret} onChange={(ret) => setAct({ ...act, ret })} label="Goods came back into stock (sales return)" />
              </>
            ) : (
              <>
                <Field label="Received into">
                  <CashAccountSelect value={act.accountCode} onChange={(accountCode) => setAct({ ...act, accountCode })} />
                </Field>
                <Field label="bKash / bank charge deducted (৳)">
                  <input type="number" value={act.fee} onChange={(e) => setAct({ ...act, fee: e.target.value })} />
                </Field>
              </>
            )}
          </div>
        </Modal>
      ) : null}
      {open ? (
        <Modal
          title="Post AR invoice"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create}>Post to GL</Button>
            </>
          }
        >
          <div className="form two">
            <Field label="Customer">
              <select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                <option value="">Select…</option>
                {(customers.data?.customers || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Invoice date">
              <input type="date" value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} />
            </Field>
            <Field label="Gross amount">
              <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="VAT (15%)">
              <input type="number" value={form.tax} onChange={(e) => setForm({ ...form, tax: e.target.value })} />
            </Field>
            <Field label="Description" full>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}
