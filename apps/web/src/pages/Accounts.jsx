import { api, money } from "../api.js";
import { Badge, Page, Table, useApi } from "../ui.jsx";

export default function Accounts() {
  const { data, error, loading } = useApi(() => api("/fico/accounts"));
  if (loading) return <p className="muted">Loading accounts…</p>;
  if (error) return <div className="err">{error}</div>;
  return (
    <Page title="Chart of accounts" subtitle="Every later module posts to these accounts through the GL posting service.">
      <Table
        columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "type", label: "Type", render: (r) => <Badge kind={r.type}>{r.type}</Badge> },
          { key: "debit", label: "Debits", num: true, render: (r) => money(r.debit) },
          { key: "credit", label: "Credits", num: true, render: (r) => money(r.credit) },
          { key: "balance", label: "Balance", num: true, render: (r) => money(r.balance) },
        ]}
        rows={data.accounts}
      />
    </Page>
  );
}
