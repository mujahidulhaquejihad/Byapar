import { useState } from "react";
import { Link } from "react-router-dom";
import { api, money } from "../api.js";
import { Badge, Button, CashAccountSelect, Field, Modal, Page, Table, useApi } from "../ui.jsx";

const blankEmp = () => ({
  name: "",
  designation: "",
  department: "",
  joinDate: new Date().toISOString().slice(0, 10),
  basic: 20000,
  houseRent: 10000,
  medical: 1500,
  conveyance: 1000,
  pfPct: 0,
  monthlyTax: 0,
  payAccount: "",
  status: "active",
});

const EMP_FIELDS = [
  ["name", "Name", "text"],
  ["designation", "Designation", "text"],
  ["department", "Department", "text"],
  ["joinDate", "Joining date", "date"],
  ["basic", "Basic (৳/month)", "number"],
  ["houseRent", "House rent (৳)", "number"],
  ["medical", "Medical (৳)", "number"],
  ["conveyance", "Conveyance (৳)", "number"],
  ["pfPct", "Provident fund % of basic (company matches)", "number"],
  ["monthlyTax", "Salary tax deducted per month (৳)", "number"],
  ["payAccount", "Bank / bKash account no.", "text"],
];

export default function Payroll() {
  const emps = useApi(() => api("/hr/employees"));
  const runs = useApi(() => api("/hr/payroll-runs"));
  const [emp, setEmp] = useState(null);
  const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15).toISOString().slice(0, 7);
  const [runForm, setRunForm] = useState(null);
  const [slipsOf, setSlipsOf] = useState(null);
  const slips = useApi(() => (slipsOf ? api(`/hr/payroll-runs/${slipsOf.id}`) : Promise.resolve(null)), [slipsOf?.id]);
  const [msg, setMsg] = useState("");
  const error = emps.error || runs.error;

  async function saveEmp() {
    try {
      const nums = ["basic", "houseRent", "medical", "conveyance", "pfPct", "monthlyTax"];
      const body = { ...emp, ...Object.fromEntries(nums.map((k) => [k, Number(emp[k]) || 0])) };
      delete body.id;
      await api(emp.id ? `/hr/employees/${emp.id}` : "/hr/employees", { method: emp.id ? "PUT" : "POST", body });
      setEmp(null);
      emps.reload();
    } catch (e) {
      emps.setError(e.message);
    }
  }

  async function doRun() {
    try {
      const r = await api("/hr/payroll-runs", {
        method: "POST",
        body: { ...runForm, bonusPct: Number(runForm.bonusPct) || 0 },
      });
      setMsg(`${r.runNo}: ${r.staff} staff, gross ${money(r.gross)}, net paid ${money(r.net)} (${r.journal})`);
      setRunForm(null);
      runs.reload();
    } catch (e) {
      runs.setError(e.message);
    }
  }

  const list = emps.data?.employees || [];
  return (
    <Page
      title="Payroll"
      subtitle="Monthly salary (basic, house rent, medical, conveyance) with provident fund and salary tax, plus festival bonuses. Each run posts to the GL and pays from the account you choose."
      actions={
        <>
          <Button kind="ghost" onClick={() => setEmp(blankEmp())}>
            Add employee
          </Button>
          <Button onClick={() => setRunForm({ period: lastMonth, kind: "salary", title: "", bonusPct: 100, accountCode: "1100" })}>Run payroll</Button>
        </>
      }
    >
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="okmsg">{msg}</div> : null}
      <Table
        columns={[
          { key: "code", label: "Code", mono: true },
          { key: "name", label: "Name" },
          { key: "designation", label: "Designation" },
          { key: "basic", label: "Basic", num: true, render: (e) => money(e.basic) },
          { key: "gross", label: "Gross / month", num: true, render: (e) => money(e.basic + e.house_rent + e.medical + e.conveyance) },
          { key: "pf_pct", label: "PF %", num: true },
          { key: "status", label: "Status", render: (e) => <Badge kind={e.status === "active" ? "open" : "cancelled"}>{e.status}</Badge> },
          {
            key: "act",
            label: "",
            render: (e) => (
              <Button
                kind="ghost"
                onClick={() =>
                  setEmp({
                    id: e.id,
                    name: e.name,
                    designation: e.designation,
                    department: e.department,
                    joinDate: e.join_date,
                    basic: e.basic,
                    houseRent: e.house_rent,
                    medical: e.medical,
                    conveyance: e.conveyance,
                    pfPct: e.pf_pct,
                    monthlyTax: e.monthly_tax,
                    payAccount: e.pay_account,
                    status: e.status,
                  })
                }
              >
                Edit
              </Button>
            ),
          },
        ]}
        rows={list}
        empty="No employees yet — click Add employee"
      />

      <h3>Payroll runs</h3>
      <Table
        columns={[
          { key: "run_no", label: "Run", mono: true },
          { key: "period", label: "Month", mono: true },
          { key: "kind", label: "Type", render: (r) => (r.kind === "bonus" ? `Bonus — ${r.title}` : "Salary") },
          { key: "staff", label: "Staff", num: true },
          { key: "gross", label: "Gross", num: true, render: (r) => money(r.gross) },
          { key: "net", label: "Net paid", num: true, render: (r) => money(r.net) },
          { key: "paid_from", label: "Paid from", mono: true },
          { key: "journal_no", label: "GL doc", mono: true },
          {
            key: "act",
            label: "",
            render: (r) => (
              <Button kind="ghost" onClick={() => setSlipsOf(r)}>
                Payslips
              </Button>
            ),
          },
        ]}
        rows={runs.data?.runs}
        empty="No payroll run yet"
      />

      {slipsOf ? (
        <Modal title={`Payslips — ${slipsOf.run_no}`} onClose={() => setSlipsOf(null)}>
          <Table
            columns={[
              { key: "name", label: "Employee" },
              { key: "gross", label: "Gross", num: true, render: (p) => money(p.gross) },
              { key: "pf_employee", label: "PF", num: true, render: (p) => money(p.pf_employee) },
              { key: "tax", label: "Tax", num: true, render: (p) => money(p.tax) },
              { key: "net", label: "Net", num: true, render: (p) => money(p.net) },
              {
                key: "act",
                label: "",
                render: (p) => (
                  <Link className="btn ghost" to={`/print/payslip/${p.id}`}>
                    Print
                  </Link>
                ),
              },
            ]}
            rows={slips.data?.payslips}
          />
        </Modal>
      ) : null}

      {runForm ? (
        <Modal title="Run payroll" onClose={() => setRunForm(null)} footer={<Button onClick={doRun}>Post & pay</Button>}>
          <div className="form two">
            <Field label="Type">
              <select value={runForm.kind} onChange={(e) => setRunForm({ ...runForm, kind: e.target.value })}>
                <option value="salary">Monthly salary</option>
                <option value="bonus">Festival bonus</option>
              </select>
            </Field>
            <Field label="Month">
              <input type="month" value={runForm.period} onChange={(e) => setRunForm({ ...runForm, period: e.target.value })} />
            </Field>
            {runForm.kind === "bonus" ? (
              <>
                <Field label="Bonus name">
                  <input value={runForm.title} placeholder="Eid-ul-Fitr 2026" onChange={(e) => setRunForm({ ...runForm, title: e.target.value })} />
                </Field>
                <Field label="Bonus % of basic">
                  <input type="number" value={runForm.bonusPct} onChange={(e) => setRunForm({ ...runForm, bonusPct: e.target.value })} />
                </Field>
              </>
            ) : null}
            <Field label="Pay from">
              <CashAccountSelect value={runForm.accountCode} onChange={(accountCode) => setRunForm({ ...runForm, accountCode })} />
            </Field>
          </div>
          <p className="muted">{list.filter((e) => e.status === "active").length} active employees will be paid. Each month (or bonus name) can only be run once.</p>
        </Modal>
      ) : null}

      {emp ? (
        <Modal title={emp.id ? `Edit ${emp.name}` : "Add employee"} onClose={() => setEmp(null)} footer={<Button onClick={saveEmp}>Save</Button>}>
          <div className="form two">
            {EMP_FIELDS.map(([k, label, type]) => (
              <Field key={k} label={label}>
                <input type={type} value={emp[k]} onChange={(e) => setEmp({ ...emp, [k]: e.target.value })} />
              </Field>
            ))}
            {emp.id ? (
              <Field label="Status">
                <select value={emp.status} onChange={(e) => setEmp({ ...emp, status: e.target.value })}>
                  <option value="active">active</option>
                  <option value="left">left</option>
                </select>
              </Field>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}
