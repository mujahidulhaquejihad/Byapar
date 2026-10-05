import { useState } from "react";
import { api, money, parseCsv } from "../api.js";
import { Button, Field, Page, Table, useApi } from "../ui.jsx";

const num = (s) => Number(String(s || "").replace(/[,৳\s]/g, "")) || 0;

/** Accepts YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY (the usual Bangladeshi bank export). */
function isoDate(s) {
  const t = String(s || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : t;
}

function toRows(csv) {
  return parseCsv(csv).map((r) => ({
    date: isoDate(r.date),
    description: r.description || r.particulars || r.narration || "",
    reference: r.reference || r.ref || r.cheque || "",
    amount: r.amount != null && r.amount !== "" ? num(r.amount) : num(r.deposit || r.credit) - num(r.withdrawal || r.debit),
  }));
}

export default function BankRec() {
  const { data, error, loading, reload, setError } = useApi(() => api("/ops/bank-rec"));
  const [csv, setCsv] = useState("date,description,reference,deposit,withdrawal\n");
  const [msg, setMsg] = useState("");
  const [pick, setPick] = useState(null);

  async function call(path, body) {
    try {
      const res = await api(`/ops/bank-rec${path}`, { method: "POST", body });
      reload();
      return res;
    } catch (e) {
      setError(e.message);
    }
  }

  async function doImport() {
    const res = await call("/import", { rows: toRows(csv) });
    if (res) setMsg(`Imported ${res.added} statement lines (${res.skipped} duplicates skipped)`);
  }

  async function auto() {
    const res = await call("/auto");
    if (res) setMsg(`Auto-matched ${res.matched} lines`);
  }

  async function matchTo(glId) {
    if (!pick) return setError("Pick a statement line first");
    if (await call("/match", { statementLineId: pick, journalLineId: glId })) setPick(null);
  }

  if (loading && !data) return <p className="muted">Loading bank reconciliation…</p>;
  const d = data || {};
  return (
    <Page
      title="Bank reconciliation"
      subtitle="DBBL statement vs account 1100. Import the bank CSV, auto-match, then match the rest by hand."
      actions={<Button onClick={auto}>Auto-match</Button>}
    >
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="okmsg">{msg}</div> : null}
      <div className="kpis">
        {[
          ["Book balance (1100)", d.glBalance],
          ["Unmatched in books", d.unmatchedGlTotal],
          ["Unmatched on statement", d.unmatchedStatementTotal],
        ].map(([lbl, val]) => (
          <div className="kpi" key={lbl}>
            <div className="lbl">{lbl}</div>
            <div className="val">{money(val)}</div>
          </div>
        ))}
      </div>

      <h3>Statement lines not yet matched {pick ? "— now pick the ledger line below" : ""}</h3>
      <Table
        columns={[
          { key: "stmt_date", label: "Date" },
          { key: "description", label: "Description" },
          { key: "reference", label: "Ref" },
          { key: "amount", label: "Amount", num: true, render: (r) => money(r.amount) },
          {
            key: "act",
            label: "",
            render: (r) => (
              <Button kind={pick === r.id ? "primary" : "ghost"} onClick={() => setPick(pick === r.id ? null : r.id)}>
                {pick === r.id ? "Selected" : "Select"}
              </Button>
            ),
          },
        ]}
        rows={d.statement}
        empty="Nothing unmatched — import a statement CSV below"
      />

      <h3>Ledger lines (1100) not on the statement</h3>
      <Table
        columns={[
          { key: "posting_date", label: "Date" },
          { key: "doc_number", label: "GL doc", mono: true },
          { key: "text", label: "Text" },
          { key: "amount", label: "Amount", num: true, render: (r) => money(r.amount) },
          {
            key: "act",
            label: "",
            render: (r) =>
              pick ? (
                <Button kind="ghost" onClick={() => matchTo(r.id)}>
                  Match
                </Button>
              ) : null,
          },
        ]}
        rows={d.gl}
      />

      <h3>Recently matched</h3>
      <Table
        columns={[
          { key: "stmt_date", label: "Statement date" },
          { key: "description", label: "Description" },
          { key: "doc_number", label: "GL doc", mono: true },
          { key: "amount", label: "Amount", num: true, render: (r) => money(r.amount) },
          {
            key: "act",
            label: "",
            render: (r) => (
              <Button kind="ghost" onClick={() => call(`/${r.id}/unmatch`)}>
                Unmatch
              </Button>
            ),
          },
        ]}
        rows={d.matched}
      />

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-h">Import statement (CSV)</div>
        <div className="panel-b form">
          <p className="muted" style={{ margin: 0 }}>
            Columns: <code>date, description, reference</code> plus either <code>amount</code> (deposits +, withdrawals −) or <code>deposit, withdrawal</code>. Dates
            as YYYY-MM-DD or DD/MM/YYYY. Re-importing the same lines is safe.
          </p>
          <Field label="CSV" full>
            <textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} style={{ fontFamily: "var(--mono)", fontSize: 12 }} />
          </Field>
          <Button onClick={doImport}>Import statement</Button>
        </div>
      </div>
    </Page>
  );
}
