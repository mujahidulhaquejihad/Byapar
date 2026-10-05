import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Badge, Page, Table, useApi } from "../ui.jsx";

export default function Deliveries() {
  const { data, error, loading } = useApi(() => api("/sd/deliveries"));
  if (loading) return <p className="muted">Loading deliveries…</p>;
  if (error) return <div className="err">{error}</div>;
  return (
    <Page title="Deliveries" subtitle="Each delivery posts COGS and reduces finished-goods stock. Print challan for the gate.">
      <Table
        columns={[
          { key: "delivery_no", label: "Delivery", mono: true },
          { key: "so_number", label: "Sales order", mono: true },
          { key: "customer_name", label: "Customer" },
          { key: "delivery_date", label: "Date", mono: true },
          { key: "journal_no", label: "GL doc", mono: true },
          { key: "status", label: "Status", render: (r) => <Badge kind={r.status}>{r.status}</Badge> },
          {
            key: "print",
            label: "",
            render: (r) => (
              <Link className="btn ghost" to={`/print/challan/${r.id}`}>
                Challan
              </Link>
            ),
          },
        ]}
        rows={data.deliveries}
      />
    </Page>
  );
}
