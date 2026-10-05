import { useState } from "react";
import { api, download, money } from "../api.js";
import { Button, Page, Table, useApi } from "../ui.jsx";

export default function VatReturn() {
  const [range, setRange] = useState({ from: "2025-07-01", to: new Date().toISOString().slice(0, 10) });
  const qs = `from=${range.from}&to=${range.to}`;
  const { data, error, loading, setError } = useApi(() => api(`/ops/vat-return?${qs}`), [qs]);
  if (loading && !data) return <p className="muted">Loading VAT…</p>;
  if (!data) return <div className="err">{error || "No VAT data returned — is the API running on port 8082?"}</div>;
  const exportCsv = () => download(`/ops/vat-return/export?${qs}`, `vat-registers-${range.from}-to-${range.to}.csv`).catch((e) => setError(e.message));
  return (
    <Page
      title="VAT return (NBR)"
      subtitle="Input vs output VAT on account 2300, plus TDS withheld from vendors (account 2500)."
      actions={
        <>
          <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          <Button onClick={exportCsv}>Export registers (CSV)</Button>
        </>
      }
    >
      {error ? <div className="err">{error}</div> : null}
      <div className="kpis">
        {[
          ["Input VAT", data.inputVat],
          ["Output VAT", data.outputVat],
          ["Net VAT payable", data.netPayable],
          ["TDS withheld (period)", data.tdsWithheld],
          ["TDS owed to NBR (now)", data.tdsPayable],
        ].map(([lbl, val]) => (
          <div className="kpi" key={lbl}>
            <div className="lbl">{lbl}</div>
            <div className="val">{money(val)}</div>
          </div>
        ))}
      </div>
      <p className="muted">
        The CSV holds sales, purchase, credit-note (Mushak 6.7), debit-note (Mushak 6.8) and TDS registers with party BINs — give it to your VAT consultant to fill
        Mushak 9.1. It is not the official NBR upload file.
      </p>
      <Table
        columns={[
          { key: "posting_date", label: "Date", mono: true },
          { key: "doc_number", label: "Doc", mono: true },
          { key: "source_module", label: "Source" },
          { key: "text", label: "Text" },
          { key: "debit", label: "Input", num: true, render: (r) => money(r.debit) },
          { key: "credit", label: "Output", num: true, render: (r) => money(r.credit) },
        ]}
        rows={data.lines}
      />
    </Page>
  );
}
