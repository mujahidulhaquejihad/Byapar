import { useState } from "react";
import { api } from "../api.js";
import { Button, Field, Modal, Page, Table, useApi } from "../ui.jsx";

export default function Lots() {
  const { data, error, loading, reload, setError } = useApi(() => api("/ops/lots"));
  const materials = useApi(() => api("/mm/materials"));
  const inventory = useApi(() => api("/mm/inventory"));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ materialId: "", storageLocationId: "", qty: 10, notes: "" });

  async function save() {
    try {
      await api("/ops/lots", {
        method: "POST",
        body: {
          materialId: Number(form.materialId),
          storageLocationId: Number(form.storageLocationId),
          qty: Number(form.qty),
          notes: form.notes,
        },
      });
      setOpen(false);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <p className="muted">Loading lots…</p>;
  return (
    <Page title="Lots / batches" subtitle="Lightweight lot tracking for finished goods (retail chain traceability)." actions={<Button onClick={() => setOpen(true)}>New lot</Button>}>
      {error ? <div className="err">{error}</div> : null}
      <Table
        columns={[
          { key: "lot_no", label: "Lot", mono: true },
          { key: "sku", label: "SKU", mono: true },
          { key: "material_name", label: "Material" },
          { key: "location_code", label: "Loc" },
          { key: "qty", label: "Qty", num: true },
          { key: "manufactured_on", label: "Made", mono: true },
        ]}
        rows={data?.lots || []}
      />
      {open ? (
        <Modal
          title="Register lot"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={save}>Save</Button>
            </>
          }
        >
          <div className="form two">
            <Field label="Material">
              <select value={form.materialId} onChange={(e) => setForm({ ...form, materialId: e.target.value })}>
                <option value="">Select…</option>
                {(materials.data?.materials || []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.sku}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Location">
              <select value={form.storageLocationId} onChange={(e) => setForm({ ...form, storageLocationId: e.target.value })}>
                <option value="">Select…</option>
                {(inventory.data?.locations || []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Qty">
              <input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
            </Field>
            <Field label="Notes">
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}
