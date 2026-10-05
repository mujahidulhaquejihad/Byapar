import { useState } from "react";
import { api } from "../api.js";
import { Button, Field, Modal, Page, Table, useApi } from "../ui.jsx";

export default function GatePasses() {
  const { data, error, loading, reload, setError } = useApi(() => api("/ops/gate-passes"));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ passType: "out", vehicleNo: "", driverName: "", refType: "DN", refId: "", gate: "Tejgaon Main" });

  async function save() {
    try {
      await api("/ops/gate-passes", { method: "POST", body: form });
      setOpen(false);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <p className="muted">Loading gate passes…</p>;
  return (
    <Page title="Gate passes" subtitle="Vehicle in/out log for Tejgaon gate — link to delivery or GR." actions={<Button onClick={() => setOpen(true)}>Issue pass</Button>}>
      {error ? <div className="err">{error}</div> : null}
      <Table
        columns={[
          { key: "pass_no", label: "Pass", mono: true },
          { key: "pass_type", label: "In/Out" },
          { key: "vehicle_no", label: "Vehicle" },
          { key: "driver_name", label: "Driver" },
          { key: "ref_type", label: "Ref" },
          { key: "ref_id", label: "Ref ID", mono: true },
          { key: "gate", label: "Gate" },
          { key: "issued_at", label: "When", mono: true },
        ]}
        rows={data?.passes || []}
      />
      {open ? (
        <Modal
          title="Gate pass"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={save}>Issue</Button>
            </>
          }
        >
          <div className="form two">
            <Field label="Type">
              <select value={form.passType} onChange={(e) => setForm({ ...form, passType: e.target.value })}>
                <option value="out">Out</option>
                <option value="in">In</option>
              </select>
            </Field>
            <Field label="Vehicle">
              <input value={form.vehicleNo} onChange={(e) => setForm({ ...form, vehicleNo: e.target.value })} placeholder="ঢাকা মেট্রো-গ-12-3456" />
            </Field>
            <Field label="Driver">
              <input value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} />
            </Field>
            <Field label="Gate">
              <input value={form.gate} onChange={(e) => setForm({ ...form, gate: e.target.value })} />
            </Field>
            <Field label="Ref type">
              <input value={form.refType} onChange={(e) => setForm({ ...form, refType: e.target.value })} />
            </Field>
            <Field label="Ref ID">
              <input value={form.refId} onChange={(e) => setForm({ ...form, refId: e.target.value })} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}
