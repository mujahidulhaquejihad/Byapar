import { useState } from "react";
import { api, money } from "../api.js";
import { Button, CashAccountSelect, Field, Modal, Page, Table, useApi } from "../ui.jsx";

export default function Cashbook() {
  const { data, error, loading, reload, setError } = useApi(() => api("/ops/cashbook"));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    txnType: "payment",
    accountCode: "1100",
    amount: 5000,
    mode: "DBBL transfer",
    counterparty: "",
    description: "",
    offsetAccount: "2000",
  });

  async function save() {
    try {
      await api("/ops/cashbook", {
        method: "POST",
        body: { ...form, amount: Number(form.amount) },
      });
      setOpen(false);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <p className="muted">Loading cashbook…</p>;
  return (
    <Page title="Cash & bank book" subtitle="Receipts, payments and transfers for petty cash, DBBL, City Bank, bKash and Nagad. For a transfer, put the receiving account in Offset account." actions={<Button onClick={() => setOpen(true)}>New voucher</Button>}>
      {error ? <div className="err">{error}</div> : null}
      <Table
        columns={[
          { key: "doc_no", label: "Doc", mono: true },
          { key: "txn_date", label: "Date", mono: true },
          { key: "txn_type", label: "Type" },
          { key: "account_code", label: "A/C", mono: true },
          { key: "mode", label: "Mode" },
          { key: "counterparty", label: "Party" },
          { key: "description", label: "Narration" },
          { key: "amount", label: "Amount", num: true, render: (r) => money(r.amount) },
        ]}
        rows={data?.transactions || []}
      />
      {open ? (
        <Modal
          title="Cash / bank voucher"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={save}>Post</Button>
            </>
          }
        >
          <div className="form two">
            <Field label="Type">
              <select value={form.txnType} onChange={(e) => setForm({ ...form, txnType: e.target.value })}>
                <option value="receipt">Receipt</option>
                <option value="payment">Payment</option>
                <option value="transfer">Transfer between accounts (e.g. bKash → bank)</option>
              </select>
            </Field>
            <Field label="Cash/Bank account">
              <CashAccountSelect value={form.accountCode} onChange={(accountCode) => setForm({ ...form, accountCode })} />
            </Field>
            <Field label="Amount (৳)">
              <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Mode">
              <input value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} />
            </Field>
            <Field label="Counterparty">
              <input value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} />
            </Field>
            <Field label="Offset account">
              <input value={form.offsetAccount} onChange={(e) => setForm({ ...form, offsetAccount: e.target.value })} placeholder="1200 / 2000 / 5900" />
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
