import { useState } from "react";
import { api } from "../api.js";
import { Button, Field, Page, useApi } from "../ui.jsx";

/** Large-touch shop-floor goods issue / quick stock view */
export default function ShopFloor() {
  const inventory = useApi(() => api("/mm/inventory"));
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState(1);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const match = (inventory.data?.inventory || []).find((r) => r.sku.toLowerCase() === sku.trim().toLowerCase());

  async function issue() {
    if (!match) {
      setErr("SKU not found in stock");
      return;
    }
    try {
      const res = await api("/mm/goods-issue", {
        method: "POST",
        body: {
          materialId: match.material_id,
          storageLocationId: match.storage_location_id,
          qty: Number(qty),
          reason: "Shop floor issue",
        },
      });
      setMsg(`Posted ${res.movementNo} · ${res.journal}`);
      setErr("");
      inventory.reload();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <Page title="Shop floor" subtitle="Big controls for warehouse GR/GI — type SKU, set qty, post issue.">
      {err ? <div className="err">{err}</div> : null}
      {msg ? <div className="okmsg">{msg}</div> : null}
      <div className="panel panel-b form" style={{ maxWidth: 480 }}>
        <Field label="SKU / barcode">
          <input style={{ fontSize: 22, padding: 14 }} value={sku} onChange={(e) => setSku(e.target.value)} placeholder="MAT-MS-PLATE" autoFocus />
        </Field>
        <Field label="Qty">
          <input style={{ fontSize: 22, padding: 14 }} type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        {match ? (
          <div className="okmsg">
            {match.material_name} · on hand {match.qty_on_hand} {match.uom} @ {match.location_code}
          </div>
        ) : null}
        <Button onClick={issue} style={{ padding: "16px 20px", fontSize: 18 }}>
          Post goods issue
        </Button>
      </div>
      <div style={{ height: 16 }} />
      <div className="panel">
        <div className="panel-h">On-hand snapshot</div>
        <table className="data">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th className="num">Qty</th>
            </tr>
          </thead>
          <tbody>
            {(inventory.data?.inventory || []).slice(0, 12).map((r) => (
              <tr key={r.id} onClick={() => setSku(r.sku)} style={{ cursor: "pointer" }}>
                <td className="mono">{r.sku}</td>
                <td>{r.material_name}</td>
                <td className="num">
                  {r.qty_on_hand} {r.uom}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
