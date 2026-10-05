import { useState } from "react";
import { api, money } from "../api.js";
import { Badge, Button, CashAccountSelect, Field, Modal, Page, useApi } from "../ui.jsx";

export default function Lcs() {
  const { data, error, loading, reload, setError } = useApi(() => api("/mm/lcs"));
  const pos = useApi(() => api("/mm/purchase-orders"));
  const [newLc, setNewLc] = useState(null);
  const [cost, setCost] = useState(null);
  const [msg, setMsg] = useState("");

  const act = async (fn, ok) => {
    try {
      const r = await fn();
      if (ok) setMsg(ok(r));
      setNewLc(null);
      setCost(null);
      reload();
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) return <p className="muted">Loading LCs…</p>;
  const types = data?.costTypes || [];
  return (
    <Page
      title="Import LCs & landed cost"
      subtitle="Open an LC against a PO, book LC charges, insurance, duty, C&F and transport as they are paid, then allocate them into item cost after the goods arrive."
      actions={<Button onClick={() => setNewLc({ poId: "", bank: "Dutch-Bangla Bank", bankLcRef: "", notes: "" })}>Open LC</Button>}
    >
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="okmsg">{msg}</div> : null}
      {!(data?.lcs || []).length ? <p className="muted">No LCs yet.</p> : null}
      {(data?.lcs || []).map((lc) => (
        <div className="doc-card" key={lc.id}>
          <div className="doc-h">
            <div>
              <div className="doc-title">
                {lc.lc_no} · {lc.po_number} · {lc.vendor_name}
              </div>
              <div className="doc-meta">
                {lc.bank} {lc.bank_lc_ref ? `· ${lc.bank_lc_ref}` : ""} · opened {lc.lc_date} · goods received {money(lc.goodsReceived)} · costs {money(lc.totalCosts)}
                {lc.goodsReceived ? ` (${((lc.totalCosts / lc.goodsReceived) * 100).toFixed(1)}% on top of goods)` : ""}
              </div>
            </div>
            <div className="row-actions">
              <Badge kind={lc.status === "open" ? "open" : "paid"}>{lc.status}</Badge>
              {lc.status === "open" ? (
                <>
                  <Button kind="ghost" onClick={() => setCost({ lc, costType: types[0], amount: "", accountCode: "1100", reference: "" })}>
                    Add cost
                  </Button>
                  <Button onClick={() => act(() => api(`/mm/lcs/${lc.id}/allocate`, { method: "POST" }), (r) => `${lc.lc_no}: ${money(r.allocated)} allocated into stock cost (${r.journal})`)}>
                    Allocate to stock
                  </Button>
                </>
              ) : (
                <span className="muted">allocated · {lc.allocation_journal_no}</span>
              )}
            </div>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Cost</th>
                <th>Reference</th>
                <th>Paid from</th>
                <th>GL doc</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {!lc.costs.length ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No costs booked yet
                  </td>
                </tr>
              ) : (
                lc.costs.map((c) => (
                  <tr key={c.id}>
                    <td>{c.cost_date}</td>
                    <td>{c.cost_type}</td>
                    <td>{c.reference}</td>
                    <td className="mono">{c.paid_from}</td>
                    <td className="mono">{c.journal_no}</td>
                    <td className="num">{money(c.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ))}

      {newLc ? (
        <Modal
          title="Open LC"
          onClose={() => setNewLc(null)}
          footer={
            <Button onClick={() => act(() => api("/mm/lcs", { method: "POST", body: { ...newLc, poId: Number(newLc.poId) } }))}>Save LC</Button>
          }
        >
          <div className="form two">
            <Field label="Purchase order">
              <select value={newLc.poId} onChange={(e) => setNewLc({ ...newLc, poId: e.target.value })}>
                <option value="">Select…</option>
                {(pos.data?.purchaseOrders || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.po_number} — {p.vendor_name} ({money(p.total)})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="LC bank">
              <input value={newLc.bank} onChange={(e) => setNewLc({ ...newLc, bank: e.target.value })} />
            </Field>
            <Field label="Bank LC number">
              <input value={newLc.bankLcRef} onChange={(e) => setNewLc({ ...newLc, bankLcRef: e.target.value })} />
            </Field>
            <Field label="Notes">
              <input value={newLc.notes} onChange={(e) => setNewLc({ ...newLc, notes: e.target.value })} />
            </Field>
          </div>
        </Modal>
      ) : null}

      {cost ? (
        <Modal
          title={`Add cost — ${cost.lc.lc_no}`}
          onClose={() => setCost(null)}
          footer={
            <Button
              onClick={() =>
                act(() =>
                  api(`/mm/lcs/${cost.lc.id}/costs`, {
                    method: "POST",
                    body: { costType: cost.costType, amount: Number(cost.amount), accountCode: cost.accountCode, reference: cost.reference },
                  })
                )
              }
            >
              Post to GL
            </Button>
          }
        >
          <div className="form two">
            <Field label="Cost type">
              <select value={cost.costType} onChange={(e) => setCost({ ...cost, costType: e.target.value })}>
                {types.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Amount (৳)">
              <input type="number" value={cost.amount} onChange={(e) => setCost({ ...cost, amount: e.target.value })} />
            </Field>
            <Field label="Paid from">
              <CashAccountSelect value={cost.accountCode} onChange={(accountCode) => setCost({ ...cost, accountCode })} />
            </Field>
            <Field label="Reference (B/E, bill no.)">
              <input value={cost.reference} onChange={(e) => setCost({ ...cost, reference: e.target.value })} />
            </Field>
          </div>
          <p className="muted">
            Creditable import VAT and AT paid at customs are not item cost — book them to 2300 with a journal entry instead.
          </p>
        </Modal>
      ) : null}
    </Page>
  );
}
