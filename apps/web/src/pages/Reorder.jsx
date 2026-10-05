import { Link } from "react-router-dom";
import { api, money } from "../api.js";
import { Page, Table, useApi } from "../ui.jsx";

export default function Reorder() {
  const { data, error, loading } = useApi(() => api("/ops/reorder"));
  if (loading) return <p className="muted">Scanning stock…</p>;
  if (error) return <div className="err">{error}</div>;
  return (
    <Page title="Stock reorder alerts" subtitle="Materials below reorder_min. Create a PO from Purchase orders when ready." actions={<Link className="btn" to="/purchase-orders">New PO</Link>}>
      <Table
        columns={[
          { key: "sku", label: "SKU", mono: true },
          { key: "name", label: "Material" },
          { key: "on_hand", label: "On hand", num: true },
          { key: "reorder_min", label: "Min", num: true },
          { key: "shortfall", label: "Short", num: true },
          { key: "suggestOrder", label: "Suggest buy", num: true },
          { key: "stdPrice", label: "Std ৳", num: true, render: (r) => money(r.stdPrice) },
        ]}
        rows={data?.alerts || []}
        empty="All materials above reorder point"
      />
    </Page>
  );
}
