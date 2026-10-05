import { Link } from "react-router-dom";
import { money, api } from "../api.js";
import { Badge, Page, Table, useApi } from "../ui.jsx";

export default function Dashboard() {
  const { data, error, loading } = useApi(() => api("/dashboard"));
  if (loading) return <p className="muted">Loading overview…</p>;
  if (error) return <div className="err">{error}</div>;
  const k = data.kpis;
  const p = data.pipeline;
  return (
    <Page title="Plant overview" subtitle={`${data.company} · ${data.city || "Dhaka"} · ${data.currencySymbol || "৳"} ${data.currency || "BDT"} · ${data.fiscalLabel || "FY 2025–26"} · ${data.postingRule}`}>
      <div className="kpis">
        <div className="kpi">
          <div className="lbl">Cash & bank</div>
          <div className="val">{money(k.cash)}</div>
          <div className="hint">Operating liquidity</div>
        </div>
        <div className="kpi">
          <div className="lbl">Inventory</div>
          <div className="val">{money(k.inventory)}</div>
          <div className="hint">At standard cost</div>
        </div>
        <div className="kpi">
          <div className="lbl">Open AR</div>
          <div className="val">{money(k.ar)}</div>
          <div className="hint">Uncollected invoices</div>
        </div>
        <div className="kpi">
          <div className="lbl">Open AP</div>
          <div className="val">{money(k.ap)}</div>
          <div className="hint">Unpaid vendors</div>
        </div>
      </div>
      <div className="kpis">
        <div className="kpi">
          <div className="lbl">Revenue YTD</div>
          <div className="val">{money(k.revenue)}</div>
        </div>
        <div className="kpi">
          <div className="lbl">COGS YTD</div>
          <div className="val">{money(k.cogs)}</div>
        </div>
        <div className="kpi">
          <div className="lbl">Gross margin</div>
          <div className="val">{money(k.grossMargin)}</div>
        </div>
        <div className="kpi">
          <div className="lbl">Net fixed assets</div>
          <div className="val">{money(k.assets)}</div>
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: 14 }}>
        <Link to="/purchase-orders" className="stat-tile">
          <div className="n">{p.openPurchaseOrders}</div>
          <div className="t">Open purchase orders</div>
        </Link>
        <Link to="/sales-orders" className="stat-tile">
          <div className="n">{p.openSalesOrders}</div>
          <div className="t">Open sales orders</div>
        </Link>
        <Link to="/production" className="stat-tile">
          <div className="n">{p.openProduction}</div>
          <div className="t">Open production</div>
        </Link>
      </div>

      <Table
        columns={[
          { key: "doc_number", label: "Document", mono: true },
          { key: "posting_date", label: "Posted", mono: true },
          { key: "source_module", label: "Source", render: (r) => <Badge kind={r.source_module}>{r.source_module}</Badge> },
          { key: "description", label: "Description" },
        ]}
        rows={data.recentJournals}
      />
    </Page>
  );
}
