import { api } from "../api.js";
import { Page, Table, useApi } from "../ui.jsx";

export default function Audit() {
  const { data, error, loading } = useApi(() => api("/audit?limit=200"));
  if (loading) return <p className="muted">Loading audit log…</p>;
  if (error) return <div className="err">{error}</div>;
  return (
    <Page title="Audit log" subtitle="Who changed what, when, and the previous/new values. Enforced by middleware on every mutating call.">
      <Table
        columns={[
          { key: "created_at", label: "When" },
          { key: "actor_email", label: "Who" },
          { key: "action", label: "Action" },
          { key: "entity_type", label: "Entity" },
          { key: "entity_id", label: "ID" },
        ]}
        rows={data.entries}
      />
    </Page>
  );
}
