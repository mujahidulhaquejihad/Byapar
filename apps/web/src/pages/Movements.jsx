import { api, money } from "../api.js";
import { Badge, Page, Table, useApi } from "../ui.jsx";

export default function Movements() {
  const { data, error, loading } = useApi(() => api("/mm/movements"));
  if (loading) return <p className="muted">Loading movements…</p>;
  if (error) return <div className="err">{error}</div>;
  return (
    <Page title="Goods movements" subtitle="Each GR and GI is tied to a journal document number — inventory never moves without a ledger posting.">
      <Table
        columns={[
          { key: "movement_no", label: "Movement" },
          { key: "movement_type", label: "Type", render: (r) => <Badge kind={r.movement_type === "GR" ? "MM" : "expense"}>{r.movement_type}</Badge> },
          { key: "sku", label: "SKU" },
          { key: "material_name", label: "Material" },
          { key: "qty", label: "Qty", num: true, render: (r) => `${r.qty} ${r.uom}` },
          { key: "value", label: "Value", num: true, render: (r) => money(r.value) },
          { key: "journal_no", label: "GL doc" },
          { key: "created_at", label: "When" },
        ]}
        rows={data.movements}
      />
    </Page>
  );
}
