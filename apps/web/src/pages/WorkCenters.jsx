import { api, money } from "../api.js";
import { Page, Table, useApi } from "../ui.jsx";

export default function WorkCenters() {
  const { data, error, loading } = useApi(() => api("/pp/work-centers"));
  if (loading) return <p className="muted">Loading work centers…</p>;
  if (error) return <div className="err">{error}</div>;
  return (
    <Page title="Work centers" subtitle="Shop-floor capacity and hourly cost rates for planning.">
      <Table
        columns={[
          { key: "code", label: "Code", mono: true },
          { key: "name", label: "Name" },
          { key: "capacity_hrs", label: "Capacity (hrs/day)", num: true },
          { key: "costPerHour", label: "Cost / hour", num: true, render: (r) => money(r.costPerHour) },
        ]}
        rows={data.workCenters}
      />
    </Page>
  );
}
