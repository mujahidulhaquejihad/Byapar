import { useState } from "react";
import { api, money } from "../api.js";
import { Badge, Button, CashAccountSelect, Field, Modal, Page, Table, useApi } from "../ui.jsx";
import { ReturnFields, stockBody } from "./AR.jsx";

export default function AP() {
  const { data, error, loading, reload, setError } = useApi(() => api("/fico/ap-invoices"));
  const vendors = useApi(() => api("/fico/vendors"));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    vendorId: "",
    invoiceDate: new Date().toISOString().slice(0, 10),
    amount: 11500,
    tax: 1500,
    description: "Vendor invoice (incl. VAT)",
  });

  async function create() {
    try {
      await api("/fico/ap-invoices", {
        method: "POST",
        body: { ...form, vendorId: Number(form.vendorId), amount: Number(form.amount), tax: Number(form.tax) },
      });
      setOpen(false);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  // act = { inv, mode: "pay" | "debit", amount, tdsPct, reason }
  const [act, setAct] = useState(null);
  const tds = act ? Math.round(Number(act.amount) * Number(act.tdsPct || 0)) / 100 : 0;

  async function submitAct() {
    try {
      const path = act.mode === "pay" ? "pay" : "debit-note";
      await api(`/fico/ap-invoices/${act.inv.id}/${path}`, {
        method: "POST",
        body:
          act.mode === "pay"
            ? { amount: Number(act.amount), tds, accountCode: act.accountCode, fee: Number(act.fee) || 0 }
            : { amount: Number(act.amount), reason: act.reason, ...stockBody(act.ret) },
      });
      setAct(null);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <p className="muted">Loading AP…</p>;
  return (
    <Page title="Accounts payable" subtitle="Vendor invoices in ৳ — Dr Expense / Input VAT, Cr AP. Payment clears AP against DBBL." actions={<Button onClick={() => setOpen(true)}>New AP invoice</Button>}>
      {error ? <div className="err">{error}</div> : null}
      <Table
        columns={[
          { key: "invoice_no", label: "Invoice" },
          { key: "vendor_name", label: "Vendor" },
          { key: "invoice_date", label: "Date" },
          { key: "due_date", label: "Due" },
          { key: "amount", label: "Amount", num: true, render: (r) => money(r.amount) },
          { key: "outstanding", label: "Outstanding", num: true, render: (r) => money(r.outstanding) },
          { key: "journal_no", label: "GL doc" },
          { key: "status", label: "Status", render: (r) => <Badge kind={r.status}>{r.status}</Badge> },
          {
            key: "act",
            label: "",
            render: (r) =>
              r.outstanding > 0 ? (
                <span className="row-actions">
                  <Button kind="ghost" onClick={() => setAct({ inv: r, mode: "pay", amount: r.outstanding, tdsPct: 0, reason: "", accountCode: "1100", fee: 0 })}>
                    Pay
                  </Button>
                  <Button kind="ghost" onClick={() => setAct({ inv: r, mode: "debit", amount: r.outstanding, tdsPct: 0, reason: "Goods returned to vendor", ret: { on: false, materialId: "", qty: 1, storageLocationId: "" } })}>
                    Debit note
                  </Button>
                </span>
              ) : null,
          },
        ]}
        rows={data?.invoices || []}
      />
      {act ? (
        <Modal
          title={`${act.mode === "pay" ? "Pay vendor" : "Debit note"} — ${act.inv.invoice_no}`}
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
            {act.inv.vendor_name} · outstanding {money(act.inv.outstanding)}
          </p>
          <div className="form two">
            <Field label="Amount cleared (৳)">
              <input type="number" value={act.amount} onChange={(e) => setAct({ ...act, amount: e.target.value })} />
            </Field>
            {act.mode === "pay" ? (
              <>
                <Field label="TDS withheld (%)">
                  <input type="number" value={act.tdsPct} onChange={(e) => setAct({ ...act, tdsPct: e.target.value })} />
                </Field>
                <Field label="Paid from">
                  <CashAccountSelect value={act.accountCode} onChange={(accountCode) => setAct({ ...act, accountCode })} />
                </Field>
                <Field label="Bank / bKash charge (৳)">
                  <input type="number" value={act.fee} onChange={(e) => setAct({ ...act, fee: e.target.value })} />
                </Field>
              </>
            ) : (
              <>
                <Field label="Reason">
                  <input value={act.reason} onChange={(e) => setAct({ ...act, reason: e.target.value })} />
                </Field>
                <ReturnFields value={act.ret} onChange={(ret) => setAct({ ...act, ret })} label="Goods sent back out of stock (purchase return)" />
              </>
            )}
          </div>
          {act.mode === "pay" ? (
            <p className="muted">
              Account pays {money(Number(act.amount) - tds + (Number(act.fee) || 0))} · TDS {money(tds)} goes to account 2500 for NBR deposit
            </p>
          ) : null}
        </Modal>
      ) : null}
      {open ? (
        <Modal
          title="Post AP invoice"
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
            <Field label="Vendor">
              <select value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}>
                <option value="">Select…</option>
                {(vendors.data?.vendors || []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.code} — {v.name}
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
