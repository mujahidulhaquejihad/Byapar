import { useState } from "react";
import { api, money } from "../api.js";
import { Badge, Page, Table, useApi } from "../ui.jsx";

export default function StockValuation() {
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const { data, error, loading } = useApi(() => api(`/mm/stock-valuation?asOf=${asOf}`), [asOf]);
  if (loading && !data) return <p className="muted">Loading stock valuation…</p>;
  const d = data || {};
  return (
    <Page
      title="Stock valuation"
      subtitle="Quantity on hand at any date (rebuilt from goods movements) × standard price, checked against inventory account 1300."
      actions={<input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />}
    >
      {error ? <div className="err">{error}</div> : null}
      <div className="kpis">
        {[
          ["Stock value", d.stockValue],
          ["GL 1300 balance", d.glValue],
          ["Difference", d.difference],
        ].map(([lbl, val]) => (
          <div className="kpi" key={lbl}>
            <div className="lbl">{lbl}</div>
            <div className="val">{money(val)}</div>
          </div>
        ))}
      </div>
      {d.difference ? (
        <p className="muted">
          A difference usually means stock was adjusted without a GL entry (e.g. opening stock or a standard price change) — post a journal to 1300 to align.
        </p>
      ) : null}
      <Table
        columns={[
          { key: "sku", label: "SKU", mono: true },
          { key: "name", label: "Material" },
          { key: "type", label: "Type", render: (r) => <Badge kind="open">{r.type}</Badge> },
          { key: "qty", label: "Qty", num: true, render: (r) => `${Math.round(r.qty * 1000) / 1000} ${r.uom}` },
          { key: "stdPrice", label: "Std price", num: true, render: (r) => money(r.stdPrice) },
          { key: "value", label: "Value", num: true, render: (r) => money(r.value) },
        ]}
        rows={d.rows}
        empty="No stock on this date"
      />
    </Page>
  );
}
