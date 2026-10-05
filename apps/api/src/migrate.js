import { run, get } from "./db.js";

/** Idempotent column / sequence patches for upgraded databases. */
export function migrate() {
  const alters = [
    "ALTER TABLE materials ADD COLUMN reorder_min REAL NOT NULL DEFAULT 0",
    "ALTER TABLE materials ADD COLUMN reorder_max REAL NOT NULL DEFAULT 0",
    "ALTER TABLE purchase_orders ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'",
    "ALTER TABLE purchase_orders ADD COLUMN cost_center_id INTEGER",
    "ALTER TABLE sales_orders ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'",
    "ALTER TABLE sales_orders ADD COLUMN cost_center_id INTEGER",
    "ALTER TABLE journal_headers ADD COLUMN cost_center_id INTEGER",
    "ALTER TABLE deliveries ADD COLUMN challan_no TEXT",
    "ALTER TABLE company_profile ADD COLUMN bin_no TEXT DEFAULT ''",
    "ALTER TABLE company_profile ADD COLUMN tin_no TEXT DEFAULT ''",
    "ALTER TABLE company_profile ADD COLUMN bank_name TEXT DEFAULT ''",
    "ALTER TABLE company_profile ADD COLUMN bank_account TEXT DEFAULT ''",
    "ALTER TABLE ar_invoices ADD COLUMN settled_cents INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE ap_invoices ADD COLUMN settled_cents INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE ap_payments ADD COLUMN tds_cents INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN credit_limit_cents INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE ar_receipts ADD COLUMN account_code TEXT NOT NULL DEFAULT '1100'",
    "ALTER TABLE ap_payments ADD COLUMN account_code TEXT NOT NULL DEFAULT '1100'",
  ];
  for (const sql of alters) {
    try {
      run(sql);
    } catch {
      /* column exists */
    }
  }

  const seqs = [
    ["CASH", "CV"],
    ["GATE", "GP"],
    ["LOT", "LOT"],
    ["CHALLAN", "CH"],
    ["CREDIT_NOTE", "CN"],
    ["DEBIT_NOTE", "DBN"],
    ["QUOTE", "QT"],
    ["LC", "LC"],
    ["EMPLOYEE", "EMP"],
    ["PAYROLL", "PR"],
  ];
  for (const [name, prefix] of seqs) {
    if (!get("SELECT name FROM sequences WHERE name = ?", [name])) {
      run("INSERT INTO sequences (name, prefix, next_val) VALUES (?, ?, 1)", [name, prefix]);
    }
  }

  // Invoices fully paid before partial payments existed
  run("UPDATE ar_invoices SET settled_cents = amount_cents WHERE status = 'paid' AND settled_cents = 0");
  run("UPDATE ap_invoices SET settled_cents = amount_cents WHERE status = 'paid' AND settled_cents = 0");

  for (const [code, name, type] of [
    ["1110", "Bank — City Bank (Current)", "asset"],
    ["1150", "bKash merchant wallet", "asset"],
    ["1160", "Nagad merchant wallet", "asset"],
    ["1350", "Goods in transit / LC costs (import)", "asset"],
    ["2500", "TDS / AIT payable (NBR)", "liability"],
    ["2600", "Provident fund payable", "liability"],
    ["5150", "Festival bonus", "expense"],
    ["5950", "Bank & MFS charges", "expense"],
  ]) {
    if (!get("SELECT id FROM gl_accounts WHERE code = ?", [code])) run("INSERT INTO gl_accounts (code, name, type) VALUES (?, ?, ?)", [code, name, type]);
  }

  // Payroll permissions for databases seeded before payroll existed (fresh DBs get them from seed)
  const adminRole = get("SELECT id FROM roles WHERE code = 'ADMIN'");
  if (adminRole) {
    for (const [code, name] of [
      ["hr.payroll.read", "View payroll"],
      ["hr.payroll.write", "Run payroll"],
    ]) {
      if (get("SELECT id FROM permissions WHERE code = ?", [code])) continue;
      const p = run("INSERT INTO permissions (code, name, module) VALUES (?, ?, 'hr')", [code, name]);
      for (const role of ["ADMIN", "ACCOUNTANT"]) {
        const r = get("SELECT id FROM roles WHERE code = ?", [role]);
        if (r) run("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [r.id, p.lastInsertRowid]);
      }
    }
  }

  if (!get("SELECT id FROM cost_centers LIMIT 1")) {
    run("INSERT INTO cost_centers (code, name, location) VALUES (?,?,?)", ["CC-TJ", "Tejgaon plant", "Dhaka"]);
    run("INSERT INTO cost_centers (code, name, location) VALUES (?,?,?)", ["CC-HO", "Head office", "Dhaka"]);
    run("INSERT INTO cost_centers (code, name, location) VALUES (?,?,?)", ["CC-GZ", "Gazipur store", "Gazipur"]);
  }

  if (!get("SELECT id FROM fiscal_periods LIMIT 1")) {
    const periods = [
      // Stay open until seed posts opening/FA into Jul–Sep; seed closes past months after.
      ["2025-07", "2025-07-01", "2025-07-31", "open"],
      ["2025-08", "2025-08-01", "2025-08-31", "open"],
      ["2025-09", "2025-09-01", "2025-09-30", "open"],
      ["2025-10", "2025-10-01", "2025-10-31", "open"],
      ["2025-11", "2025-11-01", "2025-11-30", "open"],
      ["2025-12", "2025-12-01", "2025-12-31", "open"],
      ["2026-01", "2026-01-01", "2026-01-31", "open"],
      ["2026-02", "2026-02-01", "2026-02-28", "open"],
      ["2026-03", "2026-03-01", "2026-03-31", "open"],
      ["2026-04", "2026-04-01", "2026-04-30", "open"],
      ["2026-05", "2026-05-01", "2026-05-31", "open"],
      ["2026-06", "2026-06-01", "2026-06-30", "open"],
    ];
    for (const [code, s, e, st] of periods) {
      run("INSERT INTO fiscal_periods (code, start_date, end_date, status) VALUES (?,?,?,?)", [code, s, e, st]);
    }
  }

  if (!get("SELECT key FROM app_settings WHERE key = 'approval_limit_bdt'")) {
    run("INSERT INTO app_settings (key, value) VALUES (?, ?)", ["approval_limit_bdt", "50000"]);
  }

  // Reorder defaults for existing materials
  try {
    run("UPDATE materials SET reorder_min = 200, reorder_max = 5000 WHERE type = 'raw' AND reorder_min = 0");
    run("UPDATE materials SET reorder_min = 10, reorder_max = 100 WHERE type = 'finished' AND reorder_min = 0");
  } catch {
    /* ignore */
  }

  try {
    run("UPDATE company_profile SET bin_no = '000598741-0203', tin_no = '567890123456', bank_name = 'Dutch-Bangla Bank', bank_account = '205.123.4567' WHERE id = 1 AND (bin_no IS NULL OR bin_no = '')");
  } catch {
    /* ignore */
  }

  try {
    run(
      "UPDATE company_profile SET name = 'Jomadder Global Trade', legal_name = 'Jomadder Global Trade' WHERE id = 1"
    );
    run("UPDATE users SET name = 'Jomadder Admin' WHERE email IN ('admin@erpsoft.local', 'admin@byapar.local') AND name LIKE 'Lokman%'");
    for (const [oldE, newE] of [
      ["admin@erpsoft.local", "admin@byapar.local"],
      ["accountant@erpsoft.local", "accountant@byapar.local"],
      ["buyer@erpsoft.local", "buyer@byapar.local"],
      ["sales@erpsoft.local", "sales@byapar.local"],
      ["planner@erpsoft.local", "planner@byapar.local"],
    ]) {
      run("UPDATE users SET email = ? WHERE email = ?", [newE, oldE]);
    }
    run("UPDATE materials SET name = 'Jomadder assembly unit A' WHERE code = 'FG-UNIT-A' AND name LIKE 'Lokman%'");
    run("UPDATE materials SET name = 'Jomadder utility bracket set' WHERE code = 'FG-BRACKET' AND name LIKE 'Lokman%'");
  } catch {
    /* ignore */
  }
}
