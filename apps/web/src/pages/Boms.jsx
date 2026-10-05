import { useState } from "react";
import { api, money } from "../api.js";
import { Badge, Button, Field, Modal, Page, useApi } from "../ui.jsx";

export default function Boms() {
  const { data, error, loading, reload, setError } = useApi(() => api("/pp/boms"));
  const materials = useApi(() => api("/mm/materials"));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    parentMaterialId: "",
    components: [
      { materialId: "", qty: 1, scrapPct: 0 },
      { materialId: "", qty: 1, scrapPct: 0 },
    ],
  });

  async function create() {
    try {
      await api("/pp/boms", {
        method: "POST",
        body: {
          parentMaterialId: Number(form.parentMaterialId),
          components: form.components
            .filter((c) => c.materialId)
            .map((c) => ({ materialId: Number(c.materialId), qty: Number(c.qty), scrapPct: Number(c.scrapPct) || 0 })),
        },
      });
      setOpen(false);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <p className="muted">Loading BOMs…</p>;
  return (
    <Page
      title="Bills of materials"
      subtitle="Component recipes for finished goods. Production confirmation consumes these quantities."
      actions={<Button onClick={() => setOpen(true)}>New BOM</Button>}
    >
      {error ? <div className="err">{error}</div> : null}
      {(data?.boms || []).map((bom) => (
        <div className="doc-card" key={bom.id}>
          <div className="doc-h">
            <div>
              <div className="doc-title">
                {bom.parent_sku} — {bom.parent_name}
              </div>
              <div className="doc-meta">
                v{bom.version} · unit material cost {money(bom.unitCost)}
              </div>
            </div>
            <Badge kind={bom.status}>{bom.status}</Badge>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Component</th>
                <th>Name</th>
                <th className="num">Qty</th>
                <th className="num">Scrap %</th>
                <th className="num">Ext. cost</th>
              </tr>
            </thead>
            <tbody>
              {bom.components.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.sku}</td>
                  <td>{c.material_name}</td>
                  <td className="num">
                    {c.qty} {c.uom}
                  </td>
                  <td className="num">{c.scrap_pct}</td>
                  <td className="num">{money(c.extended)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {open ? (
        <Modal
          title="Create BOM"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create}>Save BOM</Button>
            </>
          }
        >
          <div className="form">
            <Field label="Finished material">
              <select value={form.parentMaterialId} onChange={(e) => setForm({ ...form, parentMaterialId: e.target.value })}>
                <option value="">Select…</option>
                {(materials.data?.materials || [])
                  .filter((m) => m.type === "finished")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.sku} — {m.name}
                    </option>
                  ))}
              </select>
            </Field>
            {form.components.map((c, i) => (
              <div className="form two" key={i}>
                <Field label="Component">
                  <select
                    value={c.materialId}
                    onChange={(e) => {
                      const components = [...form.components];
                      components[i] = { ...c, materialId: e.target.value };
                      setForm({ ...form, components });
                    }}
                  >
                    <option value="">Select…</option>
                    {(materials.data?.materials || [])
                      .filter((m) => m.type !== "finished")
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.sku}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Qty per unit">
                  <input
                    type="number"
                    value={c.qty}
                    onChange={(e) => {
                      const components = [...form.components];
                      components[i] = { ...c, qty: e.target.value };
                      setForm({ ...form, components });
                    }}
                  />
                </Field>
              </div>
            ))}
            <Button kind="ghost" onClick={() => setForm({ ...form, components: [...form.components, { materialId: "", qty: 1, scrapPct: 0 }] })}>
              Add component
            </Button>
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}
