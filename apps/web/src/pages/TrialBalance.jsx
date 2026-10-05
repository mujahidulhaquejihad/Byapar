import { api, money } from "../api.js";
import { Page, Table, useApi } from "../ui.jsx";

export default function TrialBalance() {
  const { data, error, loading } = useApi(() => api("/fico/trial-balance"));
  if (loading) return <p className="muted">Loading trial balance…</p>;
  if (error) return <div className="err">{error}</div>;
  const rows = [
    ...data.rows,
    { code: "TOTAL", name: data.balanced ? "Balanced" : "OUT OF BALANCE", debit: data.totalDebit, credit: data.totalCredit },
  ];
  return (
    <Page title="Trial balance" subtitle={data.balanced ? "Debits equal credits. The ledger reconciles." : "Ledger is out of balance — investigate immediately."}>
      {!data.balanced ? <div className="err">Trial balance does not reconcile.</div> : <div className="okmsg">GL is in balance.</div>}
      <div style={{ height: 12 }} />
      <Table
        columns={[
          { key: "code", label: "Account" },
          { key: "name", label: "Name" },
          { key: "type", label: "Type" },
          { key: "debit", label: "Debit", num: true, render: (r) => money(r.debit) },
          { key: "credit", label: "Credit", num: true, render: (r) => money(r.credit) },
        ]}
        rows={rows}
      />
    </Page>
  );
}
