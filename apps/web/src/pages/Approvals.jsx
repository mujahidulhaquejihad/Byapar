import { api, money } from "../api.js";
import { Badge, Button, Page, Table, useApi } from "../ui.jsx";

export default function Approvals() {
  const { data, error, loading, reload, setError } = useApi(() => api("/ops/approvals"));

  async function decide(id, decision) {
    try {
      await api(`/ops/approvals/${id}/decide`, { method: "POST", body: { decision } });
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <p className="muted">Loading approvals…</p>;
  return (
    <Page title="Approvals" subtitle={`PO/SO above ৳${(data?.limit || 50000).toLocaleString("en-BD")} need a second user before receive/deliver.`}>
      {error ? <div className="err">{error}</div> : null}
      <Table
        columns={[
          { key: "entity_no", label: "Document", mono: true },
          { key: "entity_type", label: "Type" },
          { key: "requester_name", label: "Requested by" },
          { key: "amount", label: "Amount", num: true, render: (r) => money(r.amount) },
          { key: "status", label: "Status", render: (r) => <Badge kind={r.status}>{r.status}</Badge> },
          {
            key: "act",
            label: "",
            render: (r) =>
              r.status === "pending" ? (
                <span className="row-actions">
                  <Button kind="ghost" onClick={() => decide(r.id, "approved")}>
                    Approve
                  </Button>
                  <Button kind="danger" onClick={() => decide(r.id, "rejected")}>
                    Reject
                  </Button>
                </span>
              ) : null,
          },
        ]}
        rows={data?.approvals || []}
      />
    </Page>
  );
}
