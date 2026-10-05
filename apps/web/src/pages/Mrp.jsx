import { api } from "../api.js";
import { Badge, Page, Table, useApi } from "../ui.jsx";

export default function Mrp() {
  const { data, error, loading } = useApi(() => api("/ops/mrp"));
  if (loading) return <p className="muted">Running MRP…</p>;
  if (error) return <div className="err">{error}</div>;
  return (
    <Page title="MRP suggestions" subtitle={`Explodes open sales orders through BOM − stock. Generated ${data.generatedAt}`}>
      <Table
        columns={[
          { key: "kind", label: "Action", render: (r) => <Badge kind={r.kind === "produce" ? "PP" : "MM"}>{r.kind}</Badge> },
          { key: "sku", label: "SKU", mono: true },
          { key: "name", label: "Material" },
          { key: "qty", label: "Qty", num: true },
          { key: "reason", label: "Reason" },
        ]}
        rows={data.suggestions}
        empty="No gaps — demand covered by stock"
      />
    </Page>
  );
}
