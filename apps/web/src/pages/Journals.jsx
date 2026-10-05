import { useState } from "react";
import { api, money } from "../api.js";
import { Badge, Button, Field, Modal, Page, Table, useApi } from "../ui.jsx";

const emptyLine = () => ({ accountCode: "1100", debit: 0, credit: 0, text: "" });

export default function Journals() {
  const { data, error, loading, reload, setError } = useApi(() => api("/fico/journals"));
  const accounts = useApi(() => api("/fico/accounts"));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), description: "", lines: [emptyLine(), emptyLine()] });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api("/fico/journals", {
        method: "POST",
        body: {
          ...form,
          lines: form.lines.map((l) => ({ ...l, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
        },
      });
      setOpen(false);
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Loading journals…</p>;
  return (
    <Page
      title="Journal entries"
      subtitle="Manual FI postings. The posting service rejects any document that does not balance."
      actions={<Button onClick={() => setOpen(true)}>New journal</Button>}
    >
      {error ? <div className="err">{error}</div> : null}
      <Table
        columns={[
          { key: "doc_number", label: "Document" },
          { key: "posting_date", label: "Date" },
          { key: "source_module", label: "Source", render: (r) => <Badge kind={r.source_module}>{r.source_module}</Badge> },
          { key: "description", label: "Description" },
          { key: "debit", label: "Amount", num: true, render: (r) => money(r.debit) },
          { key: "status", label: "Status", render: (r) => <Badge kind={r.status}>{r.status}</Badge> },
        ]}
        rows={data?.journals || []}
      />
      {open ? (
        <Modal
          title="Post journal"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy}>
                Post to GL
              </Button>
            </>
          }
        >
          <div className="form two">
            <Field label="Date">
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Description" full>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>
          <table className="data lines" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Account</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Text</th>
              </tr>
            </thead>
            <tbody>
              {form.lines.map((line, i) => (
                <tr key={i}>
                  <td>
                    <select
                      value={line.accountCode}
                      onChange={(e) => {
                        const lines = [...form.lines];
                        lines[i] = { ...line, accountCode: e.target.value };
                        setForm({ ...form, lines });
                      }}
                    >
                      {(accounts.data?.accounts || []).map((a) => (
                        <option key={a.code} value={a.code}>
                          {a.code} {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      value={line.debit}
                      onChange={(e) => {
                        const lines = [...form.lines];
                        lines[i] = { ...line, debit: e.target.value, credit: 0 };
                        setForm({ ...form, lines });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={line.credit}
                      onChange={(e) => {
                        const lines = [...form.lines];
                        lines[i] = { ...line, credit: e.target.value, debit: 0 };
                        setForm({ ...form, lines });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      value={line.text}
                      onChange={(e) => {
                        const lines = [...form.lines];
                        lines[i] = { ...line, text: e.target.value };
                        setForm({ ...form, lines });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button kind="ghost" className="add-line" onClick={() => setForm({ ...form, lines: [...form.lines, emptyLine()] })}>
            Add line
          </Button>
        </Modal>
      ) : null}
    </Page>
  );
}
