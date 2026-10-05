import { useState } from "react";
import { api, money } from "../api.js";
import { Page, Table, useApi } from "../ui.jsx";

export default function Aging() {
  const [tab, setTab] = useState("ar");
  const { data, error, loading } = useApi(() => api(`/ops/aging/${tab}`), [tab]);
  if (loading) return <p className="muted">Loading aging…</p>;
  if (error) return <div className="err">{error}</div>;
  if (!data) return <div className="err">No aging data returned — is the API running on port 8082?</div>;
  return (
    <Page
      title="AR / AP aging"
      subtitle={`As of ${data.asOf}`}
      actions={
        <>
          <button className={`btn ${tab === "ar" ? "" : "ghost"}`} onClick={() => setTab("ar")}>
            Receivable
          </button>
          <button className={`btn ${tab === "ap" ? "" : "ghost"}`} onClick={() => setTab("ap")}>
            Payable
          </button>
        </>
      }
    >
      <div className="kpis">
        {Object.entries(data.buckets || {}).map(([k, v]) => (
          <div className="kpi" key={k}>
            <div className="lbl">{k} days</div>
            <div className="val">{money(v)}</div>
          </div>
        ))}
      </div>
      <Table
        columns={[
          { key: "partner_name", label: tab === "ar" ? "Customer" : "Vendor" },
          { key: tab === "ar" ? "invoice_no" : "invoice_no", label: "Invoice", mono: true },
          { key: "due_date", label: "Due", mono: true },
          { key: "daysPastDue", label: "Days", num: true },
          { key: "bucket", label: "Bucket" },
          { key: "amount", label: "Amount", num: true, render: (r) => money(r.amount) },
        ]}
        rows={data.rows}
      />
    </Page>
  );
}
