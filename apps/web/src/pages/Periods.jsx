import { api } from "../api.js";
import { Badge, Button, Page, Table, useApi } from "../ui.jsx";

export default function Periods() {
  const { data, error, loading, reload, setError } = useApi(() => api("/ops/periods"));

  async function lock(id, open) {
    try {
      await api(`/ops/periods/${id}/${open ? "unlock" : "lock"}`, { method: "POST" });
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <p className="muted">Loading periods…</p>;
  return (
    <Page title="Fiscal period lock" subtitle="Closed months reject new journal postings (Mushak / GR / cash included).">
      {error ? <div className="err">{error}</div> : null}
      <Table
        columns={[
          { key: "code", label: "Period", mono: true },
          { key: "start_date", label: "From", mono: true },
          { key: "end_date", label: "To", mono: true },
          { key: "status", label: "Status", render: (r) => <Badge kind={r.status === "open" ? "open" : "paid"}>{r.status}</Badge> },
          {
            key: "act",
            label: "",
            render: (r) =>
              r.status === "open" ? (
                <Button kind="ghost" onClick={() => lock(r.id, false)}>
                  Lock
                </Button>
              ) : (
                <Button kind="ghost" onClick={() => lock(r.id, true)}>
                  Unlock
                </Button>
              ),
          },
        ]}
        rows={data?.periods || []}
      />
    </Page>
  );
}
