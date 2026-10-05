import { useState } from "react";
import { Link } from "react-router-dom";
import { api, money } from "../api.js";
import { Page, Table, useApi } from "../ui.jsx";

export default function Ledgers() {
  const customers = useApi(() => api("/fico/customers"));
  const vendors = useApi(() => api("/fico/vendors"));
  const [kind, setKind] = useState("customer");
  const [id, setId] = useState("");
  const [ledger, setLedger] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const path = kind === "customer" ? `/ops/ledger/customer/${id}` : `/ops/ledger/vendor/${id}`;
      setLedger(await api(path));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Page title="Partner ledger" subtitle="Customer or vendor running documents and open balance.">
      <div className="panel panel-b form two" style={{ marginBottom: 14 }}>
        <div className="field">
          <label>Type</label>
          <select value={kind} onChange={(e) => { setKind(e.target.value); setId(""); setLedger(null); }}>
            <option value="customer">Customer</option>
            <option value="vendor">Vendor</option>
          </select>
        </div>
        <div className="field">
          <label>Partner</label>
          <select value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Select…</option>
            {(kind === "customer" ? customers.data?.customers || [] : vendors.data?.vendors || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn" type="button" onClick={load} disabled={!id}>
          Open ledger
        </button>
      </div>
      {error ? <div className="err">{error}</div> : null}
      {ledger ? (
        <>
          <div className="row-actions" style={{ marginBottom: 14 }}>
            <div className="kpi">
              <div className="lbl">Open balance</div>
              <div className="val">{money(ledger.openBalance)}</div>
            </div>
            {kind === "customer" ? (
              <Link className="btn" to={`/print/statement/${id}`}>
                Print statement of account
              </Link>
            ) : null}
          </div>
          <Table
            columns={[
              { key: "invoice_no", label: "Invoice", mono: true },
              { key: "invoice_date", label: "Date", mono: true },
              { key: "due_date", label: "Due", mono: true },
              { key: "status", label: "Status" },
              { key: "amount", label: "Amount", num: true, render: (r) => money(r.amount) },
              { key: "outstanding", label: "Outstanding", num: true, render: (r) => money(r.outstanding) },
              {
                key: "print",
                label: "",
                render: (r) =>
                  kind === "customer" ? (
                    <Link className="btn ghost" to={`/print/invoice/${r.id}`}>
                      Mushak
                    </Link>
                  ) : null,
              },
            ]}
            rows={ledger.invoices || []}
          />
        </>
      ) : null}
    </Page>
  );
}
