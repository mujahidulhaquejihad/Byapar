PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  module TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id),
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sequences (
  name TEXT PRIMARY KEY,
  prefix TEXT NOT NULL,
  next_val INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gl_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  is_posting INTEGER NOT NULL DEFAULT 1,
  is_contra INTEGER NOT NULL DEFAULT 0,
  parent_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fiscal_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL UNIQUE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS journal_headers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_number TEXT NOT NULL UNIQUE,
  doc_date TEXT NOT NULL,
  posting_date TEXT NOT NULL,
  source_module TEXT NOT NULL,
  source_id TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  header_id INTEGER NOT NULL REFERENCES journal_headers(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  account_id INTEGER NOT NULL REFERENCES gl_accounts(id),
  debit_cents INTEGER NOT NULL DEFAULT 0,
  credit_cents INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '',
  UNIQUE (header_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_jl_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_jh_date ON journal_headers(posting_date);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tax_id TEXT DEFAULT '',
  payment_terms INTEGER NOT NULL DEFAULT 30,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tax_id TEXT DEFAULT '',
  payment_terms INTEGER NOT NULL DEFAULT 30,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ap_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  invoice_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  journal_id INTEGER REFERENCES journal_headers(id),
  po_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ar_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  invoice_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  journal_id INTEGER REFERENCES journal_headers(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ap_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_no TEXT NOT NULL UNIQUE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  invoice_id INTEGER REFERENCES ap_invoices(id),
  payment_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  journal_id INTEGER REFERENCES journal_headers(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ar_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  invoice_id INTEGER REFERENCES ar_invoices(id),
  receipt_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  journal_id INTEGER REFERENCES journal_headers(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fixed_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  asset_class TEXT NOT NULL DEFAULT 'equipment',
  acquisition_date TEXT NOT NULL,
  acquisition_cents INTEGER NOT NULL,
  useful_life_months INTEGER NOT NULL DEFAULT 60,
  accum_depr_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  journal_id INTEGER REFERENCES journal_headers(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'raw' CHECK (type IN ('raw','semi','finished','consumable')),
  uom TEXT NOT NULL DEFAULT 'EA',
  std_price_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS storage_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (warehouse_id, code)
);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  storage_location_id INTEGER NOT NULL REFERENCES storage_locations(id),
  qty_on_hand REAL NOT NULL DEFAULT 0,
  qty_reserved REAL NOT NULL DEFAULT 0,
  UNIQUE (material_id, storage_location_id)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_number TEXT NOT NULL UNIQUE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  order_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS po_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  qty REAL NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  qty_received REAL NOT NULL DEFAULT 0,
  UNIQUE (po_id, line_no)
);

CREATE TABLE IF NOT EXISTS goods_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_no TEXT NOT NULL UNIQUE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('GR','GI')),
  material_id INTEGER NOT NULL REFERENCES materials(id),
  storage_location_id INTEGER NOT NULL REFERENCES storage_locations(id),
  qty REAL NOT NULL,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  ref_type TEXT,
  ref_id TEXT,
  journal_id INTEGER REFERENCES journal_headers(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_inv_mat ON inventory(material_id);

CREATE TABLE IF NOT EXISTS sales_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  so_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS so_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  so_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  qty REAL NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  qty_delivered REAL NOT NULL DEFAULT 0,
  qty_billed REAL NOT NULL DEFAULT 0,
  UNIQUE (so_id, line_no)
);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_no TEXT NOT NULL UNIQUE,
  so_id INTEGER NOT NULL REFERENCES sales_orders(id),
  delivery_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',
  journal_id INTEGER REFERENCES journal_headers(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id INTEGER NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  so_line_id INTEGER NOT NULL REFERENCES so_lines(id),
  material_id INTEGER NOT NULL REFERENCES materials(id),
  qty REAL NOT NULL,
  storage_location_id INTEGER NOT NULL REFERENCES storage_locations(id)
);

CREATE TABLE IF NOT EXISTS work_centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  capacity_hrs REAL NOT NULL DEFAULT 8,
  cost_per_hr_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS boms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_material_id INTEGER NOT NULL UNIQUE REFERENCES materials(id),
  version TEXT NOT NULL DEFAULT '1',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bom_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bom_id INTEGER NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
  component_material_id INTEGER NOT NULL REFERENCES materials(id),
  qty REAL NOT NULL,
  scrap_pct REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS production_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_number TEXT NOT NULL UNIQUE,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  work_center_id INTEGER REFERENCES work_centers(id),
  qty_planned REAL NOT NULL,
  qty_produced REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'released',
  start_date TEXT,
  due_date TEXT,
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS company_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BDT',
  fiscal_year INTEGER NOT NULL,
  country TEXT DEFAULT '',
  address TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cost_centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  location TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS fiscal_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))
);

CREATE TABLE IF NOT EXISTS cash_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT NOT NULL UNIQUE,
  txn_date TEXT NOT NULL,
  txn_type TEXT NOT NULL CHECK (txn_type IN ('receipt','payment','transfer')),
  account_code TEXT NOT NULL,
  counterparty TEXT DEFAULT '',
  amount_cents INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'cash',
  reference TEXT DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  journal_id INTEGER REFERENCES journal_headers(id),
  cost_center_id INTEGER REFERENCES cost_centers(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  entity_no TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by INTEGER REFERENCES users(id),
  decided_by INTEGER REFERENCES users(id),
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS stock_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_no TEXT NOT NULL UNIQUE,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  storage_location_id INTEGER NOT NULL REFERENCES storage_locations(id),
  qty REAL NOT NULL DEFAULT 0,
  manufactured_on TEXT,
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS gate_passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pass_no TEXT NOT NULL UNIQUE,
  pass_type TEXT NOT NULL DEFAULT 'out' CHECK (pass_type IN ('in','out')),
  ref_type TEXT,
  ref_id TEXT,
  vehicle_no TEXT DEFAULT '',
  driver_name TEXT DEFAULT '',
  gate TEXT DEFAULT 'Tejgaon Main',
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- kind 'credit' = AR credit note (against ar_invoices), 'debit' = AP debit note (against ap_invoices)
CREATE TABLE IF NOT EXISTS invoice_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_no TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('credit','debit')),
  invoice_id INTEGER NOT NULL,
  note_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  journal_id INTEGER REFERENCES journal_headers(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stmt_date TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,
  journal_line_id INTEGER UNIQUE REFERENCES journal_lines(id),
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (stmt_date, amount_cents, reference, description)
);

CREATE TABLE IF NOT EXISTS price_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  material_id INTEGER NOT NULL REFERENCES materials(id),
  unit_price_cents INTEGER NOT NULL,
  discount_pct REAL NOT NULL DEFAULT 0,
  UNIQUE (customer_id, material_id)
);

CREATE TABLE IF NOT EXISTS quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  quote_date TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','converted','cancelled')),
  so_id INTEGER REFERENCES sales_orders(id),
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotation_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  qty REAL NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  UNIQUE (quote_id, line_no)
);

CREATE TABLE IF NOT EXISTS depreciation_runs (
  period TEXT PRIMARY KEY,
  journal_id INTEGER REFERENCES journal_headers(id),
  amount_cents INTEGER NOT NULL,
  run_by INTEGER REFERENCES users(id),
  run_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS year_closes (
  fy_end TEXT PRIMARY KEY,
  journal_id INTEGER REFERENCES journal_headers(id),
  profit_cents INTEGER NOT NULL,
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Import letters of credit: costs park in 1350 until allocated into stock (landed cost)
CREATE TABLE IF NOT EXISTS lcs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lc_no TEXT NOT NULL UNIQUE,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  bank TEXT NOT NULL DEFAULT '',
  bank_lc_ref TEXT NOT NULL DEFAULT '',
  lc_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','allocated')),
  allocation_journal_id INTEGER REFERENCES journal_headers(id),
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lc_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lc_id INTEGER NOT NULL REFERENCES lcs(id),
  cost_type TEXT NOT NULL,
  cost_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_from TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  journal_id INTEGER REFERENCES journal_headers(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  designation TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  join_date TEXT NOT NULL,
  basic_cents INTEGER NOT NULL,
  house_rent_cents INTEGER NOT NULL DEFAULT 0,
  medical_cents INTEGER NOT NULL DEFAULT 0,
  conveyance_cents INTEGER NOT NULL DEFAULT 0,
  pf_pct REAL NOT NULL DEFAULT 0,
  monthly_tax_cents INTEGER NOT NULL DEFAULT 0,
  pay_account TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','left')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_no TEXT NOT NULL UNIQUE,
  period TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('salary','bonus')),
  title TEXT NOT NULL DEFAULT '',
  paid_from TEXT NOT NULL,
  pay_date TEXT NOT NULL,
  gross_cents INTEGER NOT NULL,
  net_cents INTEGER NOT NULL,
  journal_id INTEGER REFERENCES journal_headers(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (period, kind, title)
);

CREATE TABLE IF NOT EXISTS payslips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES payroll_runs(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  basic_cents INTEGER NOT NULL DEFAULT 0,
  house_rent_cents INTEGER NOT NULL DEFAULT 0,
  medical_cents INTEGER NOT NULL DEFAULT 0,
  conveyance_cents INTEGER NOT NULL DEFAULT 0,
  bonus_cents INTEGER NOT NULL DEFAULT 0,
  gross_cents INTEGER NOT NULL,
  pf_employee_cents INTEGER NOT NULL DEFAULT 0,
  pf_employer_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  net_cents INTEGER NOT NULL,
  UNIQUE (run_id, employee_id)
);
