import { useState } from "react";
import { api, money } from "../api.js";
import { Badge, Button, Field, Modal, Page, Table, useApi } from "../ui.jsx";

export default function Materials() {
  const { data, error, loading, reload, setError } = useApi(() => api("/mm/materials"));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "raw", uom: "EA", stdPrice: 10, sku: "" });

  async function create() {
    try {
      await api("/mm/materials", {
        method: "POST",
        body: { ...form, stdPrice: Number(form.stdPrice), sku: form.sku || undefined },
      });
      setOpen(false);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <p className="muted">Loading materials…</p>;
  return (
    <Page title="Material master" subtitle="Inventory valuation uses standard price. Goods movements post to the GL at this price or PO price." actions={<Button onClick={() => setOpen(true)}>New material</Button>}>
      {error ? <div className="err">{error}</div> : null}
      <Table
        columns={[
          { key: "sku", label: "SKU" },
          { key: "name", label: "Name" },
          { key: "type", label: "Type", render: (r) => <Badge>{r.type}</Badge> },
          { key: "uom", label: "UoM" },
          { key: "stdPrice", label: "Std price", num: true, render: (r) => money(r.stdPrice) },
          { key: "status", label: "Status", render: (r) => <Badge kind={r.status}>{r.status}</Badge> },
        ]}
        rows={data?.materials || []}
      />
      {open ? (
        <Modal
          title="Create material"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create}>Save</Button>
            </>
          }
        >
          <div className="form two">
            <Field label="Name" full>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="SKU (optional)">
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="Auto if empty" />
            </Field>
            <Field label="Type">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="raw">raw</option>
                <option value="semi">semi</option>
                <option value="finished">finished</option>
                <option value="consumable">consumable</option>
              </select>
            </Field>
            <Field label="UoM">
              <input value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} />
            </Field>
            <Field label="Standard price">
              <input type="number" value={form.stdPrice} onChange={(e) => setForm({ ...form, stdPrice: e.target.value })} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}
