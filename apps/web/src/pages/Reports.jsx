import { useState } from "react";
import { api, money } from "../api.js";
import { Button, Page, useApi } from "../ui.jsx";

const todayIso = () => new Date().toISOString().slice(0, 10);

function Lines({ rows, total, totalLabel }) {
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <table className="data">
        <tbody>
          {rows.map((l, i) => (
            <tr key={i} style={l.emphasize ? { fontWeight: 700, background: "#f7f8fa" } : undefined}>
              <td>{l.label ?? (l.code ? `${l.code} ${l.name}` : l.name)}</td>
              <td className="num">{money(l.amount)}</td>
            </tr>
          ))}
          {totalLabel ? (
            <tr style={{ fontWeight: 700, background: "#f7f8fa" }}>
              <td>{totalLabel}</td>
              <td className="num">{money(total)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function Kpis({ items }) {
  return (
    <div className="kpis">
      {items.map(([lbl, val]) => (
        <div className="kpi" key={lbl}>
          <div className="lbl">{lbl}</div>
          <div className="val">{money(val)}</div>
        </div>
      ))}
    </div>
  );
}

function Pnl({ from, to }) {
  const { data, error } = useApi(() => api(`/reports/pnl?${from ? `from=${from}&` : ""}to=${to}`), [from, to]);
  if (error) return <div className="err">{error}</div>;
  if (!data) return <p className="muted">Building P&L…</p>;
  return (
    <>
      <Kpis items={[["Revenue", data.revenue], ["COGS", data.cogs], ["Gross profit", data.grossProfit], ["Net profit", data.operatingIncome]]} />
      <Lines rows={data.lines} />
    </>
  );
}

function BalanceSheet({ to }) {
  const { data, error } = useApi(() => api(`/reports/balance-sheet?asOf=${to}`), [to]);
  if (error) return <div className="err">{error}</div>;
  if (!data) return <p className="muted">Building balance sheet…</p>;
  return (
    <>
      {!data.balanced ? <div className="err">Assets do not equal liabilities + equity — check for unbalanced imports.</div> : null}
      <div className="grid-2">
        <div>
          <h3>Assets</h3>
          <Lines rows={data.assets} total={data.totalAssets} totalLabel="Total assets" />
        </div>
        <div>
          <h3>Liabilities</h3>
          <Lines rows={data.liabilities} total={data.totalLiabilities} totalLabel="Total liabilities" />
          <h3>Equity</h3>
          <Lines rows={data.equity} total={data.totalEquity} totalLabel="Total equity" />
        </div>
      </div>
    </>
  );
}

function CashFlow({ from, to }) {
  const { data, error } = useApi(() => api(`/reports/cash-flow?${from ? `from=${from}&` : ""}to=${to}`), [from, to]);
  if (error) return <div className="err">{error}</div>;
  if (!data) return <p className="muted">Building cash flow…</p>;
  const titles = { operating: "Operating activities", investing: "Investing activities", financing: "Financing activities" };
  return (
    <>
      <Kpis items={[["Opening cash & bank", data.opening], ["Net change", data.netChange], ["Closing cash & bank", data.closing]]} />
      {data.sections.map((s) => (
        <div key={s.key}>
          <h3>{titles[s.key]}</h3>
          <Lines rows={s.items} total={s.total} totalLabel={`Net cash from ${s.key}`} />
        </div>
      ))}
    </>
  );
}

function YearEnd() {
  const closes = useApi(() => api("/fico/year-closes"));
  const lastJune = (() => {
    const d = new Date();
    const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
    return `${y}-06-30`;
  })();
  const [msg, setMsg] = useState("");
  async function close() {
    if (!window.confirm(`Close FY ending ${lastJune}? Profit moves to retained earnings and every month in that year is locked.`)) return;
    try {
      const r = await api("/fico/year-end-close", { method: "POST", body: { fyEnd: lastJune } });
      setMsg(`Closed FY ending ${r.fyEnd}: ${money(r.profit)} to retained earnings (${r.journal})`);
      closes.reload();
    } catch (e) {
      closes.setError(e.message);
    }
  }
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="panel-h">
        <span>Year-end close</span>
        <Button kind="ghost" onClick={close}>
          Close FY ending {lastJune}
        </Button>
      </div>
      <div className="panel-b">
        {closes.error ? <div className="err">{closes.error}</div> : null}
        {msg ? <div className="okmsg">{msg}</div> : null}
        {(closes.data?.closes || []).map((c) => (
          <div key={c.fy_end} className="muted">
            FY ending {c.fy_end} closed — {money(c.profit)} to retained earnings ({c.journal_no})
          </div>
        ))}
        {!closes.data?.closes?.length ? <div className="muted">No year closed yet.</div> : null}
      </div>
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState("pnl");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(todayIso());
  const tabs = [
    ["pnl", "Profit & loss"],
    ["bs", "Balance sheet"],
    ["cf", "Cash flow"],
  ];
  return (
    <Page
      title="Financial statements"
      subtitle="Live from the general ledger in Taka (৳). Leave 'from' empty for the current open fiscal year."
      actions={
        <>
          {tabs.map(([k, label]) => (
            <Button key={k} kind={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>
              {label}
            </Button>
          ))}
          {tab !== "bs" ? <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="From" /> : null}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value || todayIso())} title={tab === "bs" ? "As of" : "To"} />
        </>
      }
    >
      {tab === "pnl" ? <Pnl from={from} to={to} /> : tab === "bs" ? <BalanceSheet to={to} /> : <CashFlow from={from} to={to} />}
      <YearEnd />
    </Page>
  );
}
