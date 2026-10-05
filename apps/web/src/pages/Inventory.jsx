import { useState } from "react";
import { api, money } from "../api.js";
import { Button, Field, Modal, Page, Table, useApi } from "../ui.jsx";

export default function Inventory() {
  const { data, error, loading, reload, setError } = useApi(() => api("/mm/inventory"));
  const [issue, setIssue] = useState(null);
  const [qty, setQty] = useState(1);

  async function doIssue() {
    try {
      await api("/mm/goods-issue", {
        method: "POST",
        body: { materialId: issue.material_id, storageLocationId: issue.storage_location_id, qty: Number(qty), reason: "Production consumption" },
      });
      setIssue(null);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <p className="muted">Loading inventory…</p>;
  return (
    <Page title="Inventory" subtitle={`On-hand value ${money(data?.totalValue || 0)} at standard cost. Goods issue posts Dr COGS / Cr Inventory.`}>
      {error ? <div className="err">{error}</div> : null}
      <Table
        columns={[
          { key: "sku", label: "SKU" },
          { key: "material_name", label: "Material" },
          { key: "warehouse_code", label: "Warehouse" },
          { key: "location_code", label: "Location" },
          { key: "qty_on_hand", label: "On hand", num: true, render: (r) => `${r.qty_on_hand} ${r.uom}` },
          { key: "stdPrice", label: "Std price", num: true, render: (r) => money(r.stdPrice) },
          { key: "value", label: "Value", num: true, render: (r) => money(r.value) },
          {
            key: "act",
            label: "",
            render: (r) => (
              <Button kind="ghost" onClick={() => { setIssue(r); setQty(1); }}>
                Goods issue
              </Button>
            ),
          },
        ]}
        rows={data?.inventory || []}
      />
      {issue ? (
        <Modal
          title={`Issue ${issue.sku}`}
          onClose={() => setIssue(null)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setIssue(null)}>
                Cancel
              </Button>
              <Button onClick={doIssue}>Post GI</Button>
            </>
          }
        >
          <Field label="Quantity">
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        </Modal>
      ) : null}
    </Page>
  );
}
