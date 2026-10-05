import { Router } from "express";
import { z } from "zod";
import { all, get, run, tx, cents, money, today, nextNumber } from "../db.js";
import { audit } from "../audit.js";
import { requirePermission } from "../auth.js";
import { postJournal, cashAccount, nonZero } from "../posting.js";

export const hrRouter = Router();

const fail = (message) => Object.assign(new Error(message), { status: 400 });
const MONEY_FIELDS = ["basic", "house_rent", "medical", "conveyance", "monthly_tax"];
const serializeEmp = (e) => ({ ...e, ...Object.fromEntries(MONEY_FIELDS.map((f) => [f, money(e[`${f}_cents`])])) });

const empSchema = z.object({
  name: z.string().min(1),
  designation: z.string().default(""),
  department: z.string().default(""),
  joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  basic: z.number().positive(),
  houseRent: z.number().nonnegative().default(0),
  medical: z.number().nonnegative().default(0),
  conveyance: z.number().nonnegative().default(0),
  pfPct: z.number().min(0).max(20).default(0),
  monthlyTax: z.number().nonnegative().default(0),
  payAccount: z.string().default(""),
  status: z.enum(["active", "left"]).default("active"),
});
const empValues = (d) => [d.name, d.designation, d.department, d.joinDate, cents(d.basic), cents(d.houseRent), cents(d.medical), cents(d.conveyance), d.pfPct, cents(d.monthlyTax), d.payAccount, d.status];
const EMP_COLS = "name, designation, department, join_date, basic_cents, house_rent_cents, medical_cents, conveyance_cents, pf_pct, monthly_tax_cents, pay_account, status";

hrRouter.get("/employees", requirePermission("hr.payroll.read"), (_req, res) => {
  res.json({ employees: all("SELECT * FROM employees ORDER BY status, code").map(serializeEmp) });
});

hrRouter.post("/employees", requirePermission("hr.payroll.write"), (req, res) => {
  const parsed = empSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const code = nextNumber("EMPLOYEE");
  const r = run(`INSERT INTO employees (code, ${EMP_COLS}) VALUES (?, ?,?,?,?,?,?,?,?,?,?,?,?)`, [code, ...empValues(parsed.data)]);
  audit(req, { action: "CREATE", entityType: "employee", entityId: code });
  res.status(201).json({ employee: serializeEmp(get("SELECT * FROM employees WHERE id = ?", [r.lastInsertRowid])) });
});

hrRouter.put("/employees/:id", requirePermission("hr.payroll.write"), (req, res) => {
  const parsed = empSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const before = get("SELECT * FROM employees WHERE id = ?", [req.params.id]);
  if (!before) return res.status(404).json({ error: "Employee not found" });
  run(`UPDATE employees SET ${EMP_COLS.split(", ").map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...empValues(parsed.data), before.id]);
  audit(req, { action: "UPDATE", entityType: "employee", entityId: before.code, before, after: parsed.data });
  res.json({ ok: true });
});

/** Monthly salary (with PF both sides + salary tax) or a festival bonus (percent of basic). One run per period/kind/title. */
export function runPayroll(db, { period, kind, title = "", bonusPct = 100, accountCode = "1100", payDate }, userId) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw fail("Period must be YYYY-MM");
  if (kind === "bonus" && !title.trim()) throw fail("Give the bonus a name, e.g. Eid-ul-Fitr 2026");
  const t = kind === "bonus" ? title.trim() : "";
  if (get("SELECT id FROM payroll_runs WHERE period = ? AND kind = ? AND title = ?", [period, kind, t])) {
    throw fail(kind === "salary" ? `Salary for ${period} was already run` : `${t} bonus for ${period} was already run`);
  }
  const account = cashAccount(accountCode);
  const [y, m] = period.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const emps = all("SELECT * FROM employees WHERE status = 'active' AND join_date <= ? ORDER BY code", [monthEnd]);
  if (!emps.length) throw fail("No active employees for that month");
  const slips = emps.map((e) => {
    if (kind === "bonus") {
      const bonus = Math.round((e.basic_cents * bonusPct) / 100);
      return { e, basic: 0, hra: 0, med: 0, conv: 0, bonus, gross: bonus, pfEmp: 0, pfEr: 0, tax: 0, net: bonus };
    }
    const gross = e.basic_cents + e.house_rent_cents + e.medical_cents + e.conveyance_cents;
    const pf = Math.round((e.basic_cents * e.pf_pct) / 100);
    const net = gross - pf - e.monthly_tax_cents;
    if (net < 0) throw fail(`${e.name}: deductions are more than gross pay`);
    return { e, basic: e.basic_cents, hra: e.house_rent_cents, med: e.medical_cents, conv: e.conveyance_cents, bonus: 0, gross, pfEmp: pf, pfEr: pf, tax: e.monthly_tax_cents, net };
  });
  const sum = (k) => slips.reduce((s, x) => s + x[k], 0);
  const no = nextNumber("PAYROLL");
  const date = payDate || today();
  const label = kind === "bonus" ? `${t} bonus` : `Salary ${period}`;
  const posted = postJournal(db, {
    date,
    postingDate: date,
    sourceModule: "HR",
    sourceId: no,
    description: `${label} — ${slips.length} staff`,
    userId,
    lines: nonZero([
      { accountCode: kind === "bonus" ? "5150" : "5100", debit: money(sum("gross") + sum("pfEr")), text: label },
      { accountCode: "2600", credit: money(sum("pfEmp") + sum("pfEr")), text: "Provident fund (employee + employer)" },
      { accountCode: "2500", credit: money(sum("tax")), text: "Tax deducted from salary (NBR)" },
      { accountCode: account, credit: money(sum("net")), text: `Net pay ${label}` },
    ]),
  });
  const r = run(
    "INSERT INTO payroll_runs (run_no, period, kind, title, paid_from, pay_date, gross_cents, net_cents, journal_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [no, period, kind, t, account, date, sum("gross"), sum("net"), posted.id, userId]
  );
  for (const s of slips) {
    run(
      `INSERT INTO payslips (run_id, employee_id, basic_cents, house_rent_cents, medical_cents, conveyance_cents, bonus_cents, gross_cents, pf_employee_cents, pf_employer_cents, tax_cents, net_cents)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.lastInsertRowid, s.e.id, s.basic, s.hra, s.med, s.conv, s.bonus, s.gross, s.pfEmp, s.pfEr, s.tax, s.net]
    );
  }
  return { runNo: no, journal: posted.docNumber, staff: slips.length, gross: money(sum("gross")), net: money(sum("net")) };
}

hrRouter.get("/payroll-runs", requirePermission("hr.payroll.read"), (_req, res) => {
  const runs = all(
    "SELECT r.*, h.doc_number AS journal_no, (SELECT COUNT(*) FROM payslips WHERE run_id = r.id) AS staff FROM payroll_runs r LEFT JOIN journal_headers h ON h.id = r.journal_id ORDER BY r.id DESC"
  ).map((r) => ({ ...r, gross: money(r.gross_cents), net: money(r.net_cents) }));
  res.json({ runs });
});

const slipSql = `SELECT p.*, e.code, e.name, e.designation, e.department, e.pay_account, r.run_no, r.period, r.kind, r.title, r.pay_date
  FROM payslips p JOIN employees e ON e.id = p.employee_id JOIN payroll_runs r ON r.id = p.run_id`;
const serializeSlip = (p) => ({
  ...p,
  ...Object.fromEntries(
    ["basic", "house_rent", "medical", "conveyance", "bonus", "gross", "pf_employee", "pf_employer", "tax", "net"].map((f) => [f, money(p[`${f}_cents`])])
  ),
});

hrRouter.get("/payroll-runs/:id", requirePermission("hr.payroll.read"), (req, res) => {
  res.json({ payslips: all(`${slipSql} WHERE p.run_id = ? ORDER BY e.code`, [req.params.id]).map(serializeSlip) });
});

hrRouter.get("/payslips/:id", requirePermission("hr.payroll.read"), (req, res) => {
  const p = get(`${slipSql} WHERE p.id = ?`, [req.params.id]);
  if (!p) return res.status(404).json({ error: "Payslip not found" });
  res.json({ type: "payslip", title: "Payslip", company: get("SELECT * FROM company_profile WHERE id = 1"), payslip: serializeSlip(p) });
});

hrRouter.post("/payroll-runs", requirePermission("hr.payroll.write"), (req, res) => {
  const parsed = z
    .object({
      period: z.string(),
      kind: z.enum(["salary", "bonus"]),
      title: z.string().default(""),
      bonusPct: z.number().min(0).max(300).default(100),
      accountCode: z.string().default("1100"),
      payDate: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const result = tx((db) => runPayroll(db, parsed.data, req.user.id));
    audit(req, { action: "PAYROLL", entityType: "payroll_run", entityId: result.runNo, after: result });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});
