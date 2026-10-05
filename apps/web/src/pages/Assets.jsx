import { useState } from "react";
import { api, money } from "../api.js";
import { Badge, Button, Field, Modal, Page, Table, useApi } from "../ui.jsx";

export default function Assets() {
  const { data, error, loading, reload, setError } = useApi(() => api("/fico/assets"));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    assetClass: "machinery",
    acquisitionDate: new Date().toISOString().slice(0, 10),
    acquisition: 25000,
    usefulLifeMonths: 60,
  });

  async function create() {
    try {
      await api("/fico/assets", {
        method: "POST",
        body: { ...form, acquisition: Number(form.acquisition), usefulLifeMonths: Number(form.usefulLifeMonths) },
      });
      setOpen(false);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  const runs = useApi(() => api("/fico/depreciation-runs"));
  const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15).toISOString().slice(0, 7);
  const [period, setPeriod] = useState(lastMonth);
  const [msg, setMsg] = useState("");

  async function runDepr() {
    try {
      const r = await api("/fico/depreciation-runs", { method: "POST", body: { period } });
      setMsg(`Depreciation for ${r.period}: ${money(r.amount)} across ${r.assets} assets — ${r.journal}`);
      reload();
      runs.reload();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <p className="muted">Loading assets…</p>;
  return (
    <Page
      title="Fixed assets"
      subtitle="Acquisition posts Dr Fixed Assets / Cr Bank. The monthly run posts straight-line depreciation for every active asset, once per month."
      actions={
        <>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <Button kind="ghost" onClick={runDepr}>
            Run depreciation
          </Button>
          <Button onClick={() => setOpen(true)}>Acquire asset</Button>
        </>
      }
    >
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="okmsg">{msg}</div> : null}
      <Table
        columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "asset_class", label: "Class" },
          { key: "acquisition_date", label: "Acquired" },
          { key: "acquisition", label: "Cost", num: true, render: (r) => money(r.acquisition) },
          { key: "accumDepr", label: "Accum. depr.", num: true, render: (r) => money(r.accumDepr) },
          { key: "netBook", label: "Net book", num: true, render: (r) => money(r.netBook) },
          { key: "status", label: "Status", render: (r) => <Badge kind={r.status}>{r.status}</Badge> },
        ]}
        rows={data?.assets || []}
      />
      <h3>Depreciation runs</h3>
      <Table
        columns={[
          { key: "period", label: "Month", mono: true },
          { key: "amount", label: "Amount", num: true, render: (r) => money(r.amount) },
          { key: "journal_no", label: "GL doc", mono: true },
          { key: "run_at", label: "Run at" },
        ]}
        rows={runs.data?.runs}
        empty="No runs yet — pick a month and click Run depreciation"
      />
      {open ? (
        <Modal
          title="Acquire asset"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create}>Post to GL</Button>
            </>
          }
        >
          <div className="form two">
            <Field label="Name" full>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Class">
              <select value={form.assetClass} onChange={(e) => setForm({ ...form, assetClass: e.target.value })}>
                <option>machinery</option>
                <option>equipment</option>
                <option>vehicle</option>
                <option>building</option>
              </select>
            </Field>
            <Field label="Date">
              <input type="date" value={form.acquisitionDate} onChange={(e) => setForm({ ...form, acquisitionDate: e.target.value })} />
            </Field>
            <Field label="Acquisition cost">
              <input type="number" value={form.acquisition} onChange={(e) => setForm({ ...form, acquisition: e.target.value })} />
            </Field>
            <Field label="Useful life (months)">
              <input type="number" value={form.usefulLifeMonths} onChange={(e) => setForm({ ...form, usefulLifeMonths: e.target.value })} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}
