import bcrypt from "bcryptjs";
import { all, get, run, tx } from "./db.js";
import { postJournal } from "./posting.js";

const PERMISSIONS = [
  ["dashboard.read", "View dashboard", "home"],
  ["reports.read", "View reports", "home"],
  ["security.users.read", "View users", "security"],
  ["security.users.write", "Manage users", "security"],
  ["security.roles.write", "Manage roles", "security"],
  ["security.audit.read", "View audit log", "security"],
  ["fico.gl.read", "View general ledger", "fico"],
  ["fico.gl.write", "Post to general ledger", "fico"],
  ["fico.ap.read", "View accounts payable", "fico"],
  ["fico.ap.write", "Manage accounts payable", "fico"],
  ["fico.ar.read", "View accounts receivable", "fico"],
  ["fico.ar.write", "Manage accounts receivable", "fico"],
  ["fico.assets.read", "View fixed assets", "fico"],
  ["fico.assets.write", "Manage fixed assets", "fico"],
  ["mm.materials.read", "View materials", "mm"],
  ["mm.materials.write", "Manage materials", "mm"],
  ["mm.po.read", "View purchase orders", "mm"],
  ["mm.po.write", "Manage purchase orders", "mm"],
  ["mm.inventory.read", "View inventory", "mm"],
  ["mm.inventory.post", "Post goods movements", "mm"],
  ["sd.orders.read", "View sales orders", "sd"],
  ["sd.orders.write", "Manage sales orders", "sd"],
  ["sd.deliver.write", "Post deliveries", "sd"],
  ["sd.billing.write", "Bill sales orders", "sd"],
  ["pp.bom.read", "View BOMs", "pp"],
  ["pp.bom.write", "Manage BOMs", "pp"],
  ["pp.orders.read", "View production orders", "pp"],
  ["pp.orders.write", "Manage production orders", "pp"],
  ["hr.payroll.read", "View payroll", "hr"],
  ["hr.payroll.write", "Run payroll", "hr"],
];

const ACCOUNTS = [
  ["1000", "Petty cash — Tejgaon office", "asset"],
  ["1100", "Bank — Dutch-Bangla Bank (Current)", "asset"],
  ["1200", "Accounts receivable", "asset"],
  ["1300", "Inventory (RM / FG)", "asset"],
  ["1400", "Advance & deposits", "asset"],
  ["1500", "Plant & machinery", "asset"],
  ["1510", "Accumulated depreciation", "asset", 1],
  ["2000", "Accounts payable", "liability"],
  ["2100", "GR/IR clearing", "liability"],
  ["2200", "Accrued expenses", "liability"],
  ["2300", "VAT payable / receivable (NBR)", "liability"],
  ["2400", "Short-term bank loan", "liability"],
  ["3000", "Share capital", "equity"],
  ["3100", "Retained earnings", "equity"],
  ["4000", "Domestic sales revenue", "revenue"],
  ["4100", "Other income", "revenue"],
  ["5000", "Cost of goods sold", "expense"],
  ["5100", "Salaries & wages", "expense"],
  ["5200", "Factory rent / lease", "expense"],
  ["5300", "Depreciation expense", "expense"],
  ["5400", "Electricity (DPDC)", "expense"],
  ["5900", "Other operating expenses", "expense"],
];

function hash(pw) {
  return bcrypt.hashSync(pw, 10);
}

export function seedIfEmpty() {
  if (get("SELECT id FROM users LIMIT 1")) return false;

  tx((db) => {
    for (const [code, name, module] of PERMISSIONS) {
      run("INSERT INTO permissions (code, name, module) VALUES (?, ?, ?)", [code, name, module]);
    }

    const adminRole = run("INSERT INTO roles (code, name, description) VALUES (?,?,?)", ["ADMIN", "Administrator", "Full system access"]);
    const acctRole = run("INSERT INTO roles (code, name, description) VALUES (?,?,?)", ["ACCOUNTANT", "Accountant", "Finance"]);
    const buyerRole = run("INSERT INTO roles (code, name, description) VALUES (?,?,?)", ["BUYER", "Buyer", "Purchasing"]);
    const salesRole = run("INSERT INTO roles (code, name, description) VALUES (?,?,?)", ["SALES", "Sales", "Order-to-cash"]);
    const plantRole = run("INSERT INTO roles (code, name, description) VALUES (?,?,?)", ["PLANNER", "Production planner", "Shop floor"]);
    const viewRole = run("INSERT INTO roles (code, name, description) VALUES (?,?,?)", ["VIEWER", "Viewer", "Read-only"]);

    const allPerms = all("SELECT id, code FROM permissions");
    const grant = (roleId, filter) => {
      for (const p of allPerms) {
        if (filter(p.code)) run("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, p.id]);
      }
    };
    grant(adminRole.lastInsertRowid, () => true);
    grant(acctRole.lastInsertRowid, (c) => c.startsWith("fico.") || c.startsWith("hr.") || ["dashboard.read", "reports.read", "security.audit.read"].includes(c));
    grant(buyerRole.lastInsertRowid, (c) => c.startsWith("mm.") || c === "dashboard.read" || c === "fico.ap.read");
    grant(salesRole.lastInsertRowid, (c) => c.startsWith("sd.") || ["dashboard.read", "mm.inventory.read", "fico.ar.read"].includes(c));
    grant(plantRole.lastInsertRowid, (c) => c.startsWith("pp.") || c.startsWith("mm.") || c === "dashboard.read");
    grant(viewRole.lastInsertRowid, (c) => (c.endsWith(".read") && !c.startsWith("hr.")) || c === "dashboard.read");

    const admin = run("INSERT INTO users (email, name, password_hash) VALUES (?,?,?)", ["admin@byapar.local", "Jomadder Admin", hash("Admin@2027")]);
    const accountant = run("INSERT INTO users (email, name, password_hash) VALUES (?,?,?)", ["accountant@byapar.local", "Nadia Rahman", hash("Demo@2027")]);
    const buyer = run("INSERT INTO users (email, name, password_hash) VALUES (?,?,?)", ["buyer@byapar.local", "Karim Hassan", hash("Demo@2027")]);
    const sales = run("INSERT INTO users (email, name, password_hash) VALUES (?,?,?)", ["sales@byapar.local", "Ayesha Khan", hash("Demo@2027")]);
    const planner = run("INSERT INTO users (email, name, password_hash) VALUES (?,?,?)", ["planner@byapar.local", "Rafiq Ahmed", hash("Demo@2027")]);

    run("INSERT INTO user_roles (user_id, role_id) VALUES (?,?)", [admin.lastInsertRowid, adminRole.lastInsertRowid]);
    run("INSERT INTO user_roles (user_id, role_id) VALUES (?,?)", [accountant.lastInsertRowid, acctRole.lastInsertRowid]);
    run("INSERT INTO user_roles (user_id, role_id) VALUES (?,?)", [buyer.lastInsertRowid, buyerRole.lastInsertRowid]);
    run("INSERT INTO user_roles (user_id, role_id) VALUES (?,?)", [sales.lastInsertRowid, salesRole.lastInsertRowid]);
    run("INSERT INTO user_roles (user_id, role_id) VALUES (?,?)", [planner.lastInsertRowid, plantRole.lastInsertRowid]);

    for (const [name, prefix] of [
      ["JOURNAL", "JE"], ["AP_INV", "AP"], ["AR_INV", "AR"], ["AP_PAY", "PAY"], ["AR_RCT", "RCT"],
      ["ASSET", "FA"], ["PO", "PO"], ["GR", "GR"], ["GI", "GI"], ["VENDOR", "V"], ["CUSTOMER", "C"],
      ["MATERIAL", "MAT"], ["SO", "SO"], ["DN", "DN"], ["PROD", "PR"],
    ]) {
      run("INSERT INTO sequences (name, prefix, next_val) VALUES (?, ?, 1)", [name, prefix]);
    }

    for (const [code, name, type, contra] of ACCOUNTS) {
      run("INSERT INTO gl_accounts (code, name, type, is_contra) VALUES (?,?,?,?)", [code, name, type, contra ? 1 : 0]);
    }

    run("INSERT INTO fiscal_years (year, start_date, end_date, status) VALUES (?,?,?,?)", [2026, "2025-07-01", "2026-06-30", "open"]);
    run("INSERT INTO company_profile (id, name, legal_name, currency, fiscal_year, country, address) VALUES (1,?,?,?,?,?,?)", [
      "Jomadder Global Trade",
      "Jomadder Global Trade",
      "BDT",
      2026,
      "BD",
      "Plot 14, Road 3, Tejgaon Industrial Area, Dhaka-1208 · BIN 000598741-0203 · TIN 567890123456",
    ]);

    const wh = run("INSERT INTO warehouses (code, name) VALUES (?,?)", ["WH01", "Tejgaon plant store"]);
    run("INSERT INTO storage_locations (warehouse_id, code, name) VALUES (?,?,?)", [wh.lastInsertRowid, "RM01", "Raw materials"]);
    run("INSERT INTO storage_locations (warehouse_id, code, name) VALUES (?,?,?)", [wh.lastInsertRowid, "FG01", "Finished goods"]);
    run("INSERT INTO storage_locations (warehouse_id, code, name) VALUES (?,?,?)", [wh.lastInsertRowid, "SF01", "Shop floor"]);

    for (const row of [
      ["V-BSRM", "BSRM Steels Ltd.", "000112233-0101", "sales.dhaka@bsrm.com.bd"],
      ["V-AKIJ", "Akij Packaging Industries", "000445566-0102", "orders@akijpackaging.com.bd"],
      ["V-DPDC", "Dhaka Power Distribution Co.", "000778899-0103", "corporate@dpdc.org.bd"],
    ]) run("INSERT INTO vendors (code, name, tax_id, email, payment_terms) VALUES (?,?,?,?,30)", row);

    for (const row of [
      ["C-AGORA", "Agora Limited", "000221100-0201", "procurement@agora.com.bd"],
      ["C-CTG", "Chattogram Hardware Traders", "000334455-0202", "accounts@ctghardware.com.bd"],
      ["C-UNIMART", "Unimart Corporate Buying", "000667788-0203", "ap@unimart.com.bd"],
    ]) run("INSERT INTO customers (code, name, tax_id, email, payment_terms) VALUES (?,?,?,?,30)", row);

    // Prices in paisa (1/100 ৳): e.g. 18500 = ৳185.00
    for (const row of [
      ["MAT-MS-PLATE", "MS plate 6mm (hot-rolled)", "raw", "KG", 18500],
      ["MAT-BOLT-M8", "M8 hex bolt box (100 pcs)", "raw", "BOX", 42000],
      ["MAT-CARTON", "Corrugated export carton", "consumable", "EA", 9500],
      ["MAT-ENAMEL", "Industrial enamel paint (local)", "raw", "L", 13500],
      ["FG-UNIT-A", "Jomadder assembly unit A", "finished", "EA", 820000],
      ["FG-BRACKET", "Jomadder utility bracket set", "finished", "EA", 240000],
    ]) run("INSERT INTO materials (sku, name, type, uom, std_price_cents) VALUES (?,?,?,?,?)", row);

    const locRm = get("SELECT id FROM storage_locations WHERE code = 'RM01'");
    const locFg = get("SELECT id FROM storage_locations WHERE code = 'FG01'");
    const steel = get("SELECT id FROM materials WHERE sku = 'MAT-MS-PLATE'");
    const bolts = get("SELECT id FROM materials WHERE sku = 'MAT-BOLT-M8'");
    const paint = get("SELECT id FROM materials WHERE sku = 'MAT-ENAMEL'");
    const widget = get("SELECT id FROM materials WHERE sku = 'FG-UNIT-A'");
    const bracket = get("SELECT id FROM materials WHERE sku = 'FG-BRACKET'");

    for (const [mid, loc, qty] of [
      [steel.id, locRm.id, 3200], [bolts.id, locRm.id, 80], [paint.id, locRm.id, 200],
      [widget.id, locFg.id, 24], [bracket.id, locFg.id, 60],
    ]) run("INSERT INTO inventory (material_id, storage_location_id, qty_on_hand) VALUES (?,?,?)", [mid, loc, qty]);

    // Labour cost ~৳4,500/hr and ৳3,800/hr
    run("INSERT INTO work_centers (code, name, capacity_hrs, cost_per_hr_cents) VALUES (?,?,?,?)", ["WC-FAB", "Fabrication bay — Tejgaon", 16, 450000]);
    run("INSERT INTO work_centers (code, name, capacity_hrs, cost_per_hr_cents) VALUES (?,?,?,?)", ["WC-ASM", "Final assembly line A", 12, 380000]);
    const wcAsm = get("SELECT id FROM work_centers WHERE code = 'WC-ASM'");

    const bomW = run("INSERT INTO boms (parent_material_id, version, status) VALUES (?,'1','active')", [widget.id]);
    run("INSERT INTO bom_components (bom_id, component_material_id, qty, scrap_pct) VALUES (?,?,?,?)", [bomW.lastInsertRowid, steel.id, 12, 2]);
    run("INSERT INTO bom_components (bom_id, component_material_id, qty, scrap_pct) VALUES (?,?,?,?)", [bomW.lastInsertRowid, bolts.id, 0.2, 0]);
    run("INSERT INTO bom_components (bom_id, component_material_id, qty, scrap_pct) VALUES (?,?,?,?)", [bomW.lastInsertRowid, paint.id, 0.5, 5]);

    const bomB = run("INSERT INTO boms (parent_material_id, version, status) VALUES (?,'1','active')", [bracket.id]);
    run("INSERT INTO bom_components (bom_id, component_material_id, qty, scrap_pct) VALUES (?,?,?,?)", [bomB.lastInsertRowid, steel.id, 2.5, 1]);
    run("INSERT INTO bom_components (bom_id, component_material_id, qty, scrap_pct) VALUES (?,?,?,?)", [bomB.lastInsertRowid, bolts.id, 0.05, 0]);

    const uid = Number(admin.lastInsertRowid);

    // Opening inventory at std cost (৳): 3200*185 + 80*420 + 200*135 + 24*8200 + 60*2400 = 592000+33600+27000+196800+144000 = 993400
    postJournal(db, {
      date: "2025-07-01", postingDate: "2025-07-01", sourceModule: "FICO", sourceId: "OPENING",
      description: "Opening balances — FY 2025–26 (Jomadder Global Trade, Dhaka)", userId: uid,
      lines: [
        { accountCode: "1100", debit: 25000000, text: "DBBL current A/C opening" },
        { accountCode: "1000", debit: 150000, text: "Petty cash Tejgaon" },
        { accountCode: "1300", debit: 993400, text: "Opening inventory at std cost" },
        { accountCode: "1500", debit: 8500000, text: "Plant & machinery opening" },
        { accountCode: "3000", credit: 10000000, text: "Paid-up share capital" },
        { accountCode: "3100", credit: 24643400, text: "Retained earnings brought forward" },
      ],
    });

    const steelVendor = get("SELECT id FROM vendors WHERE code = 'V-BSRM'");
    const po = run(
      "INSERT INTO purchase_orders (po_number, vendor_id, order_date, status, notes, created_by) VALUES (?,?,?,?,?,?)",
      ["PO-2026-00001", steelVendor.id, "2026-02-10", "partial", "MS plate replenishment — Tejgaon", uid]
    );
    run("INSERT INTO po_lines (po_id, line_no, material_id, qty, unit_price_cents, qty_received) VALUES (?,1,?,?,?,?)", [
      po.lastInsertRowid, steel.id, 800, 18500, 400,
    ]);

    const grJe = postJournal(db, {
      date: "2026-02-18", postingDate: "2026-02-18", sourceModule: "MM", sourceId: "PO-2026-00001",
      description: "Goods receipt PO-2026-00001 — MS plate from BSRM", userId: uid,
      lines: [
        { accountCode: "1300", debit: 74000, text: "400 KG MS plate @ ৳185" },
        { accountCode: "2100", credit: 74000, text: "GR/IR PO-2026-00001" },
      ],
    });
    run(
      `INSERT INTO goods_movements (movement_no, movement_type, material_id, storage_location_id, qty, unit_cost_cents, ref_type, ref_id, journal_id, created_by)
       VALUES ('GR-2026-00001','GR',?,?,?,?,'PO',?,?,?)`,
      [steel.id, locRm.id, 400, 18500, String(po.lastInsertRowid), grJe.id, uid]
    );
    run("UPDATE inventory SET qty_on_hand = qty_on_hand + 400 WHERE material_id = ? AND storage_location_id = ?", [steel.id, locRm.id]);

    const apJe = postJournal(db, {
      date: "2026-02-20", postingDate: "2026-02-20", sourceModule: "FICO", sourceId: "AP",
      description: "AP invoice BSRM — GR match (incl. 15% VAT)", userId: uid,
      lines: [
        { accountCode: "2100", debit: 74000, text: "Clear GR/IR" },
        { accountCode: "2300", debit: 11100, text: "Input VAT 15% (NBR)" },
        { accountCode: "2000", credit: 85100, text: "AP BSRM Steels" },
      ],
    });
    run(
      `INSERT INTO ap_invoices (invoice_no, vendor_id, invoice_date, due_date, amount_cents, tax_cents, description, status, journal_id, po_id, created_by)
       VALUES (?,?,?,?,?,?,?,'open',?,?,?)`,
      ["AP-2026-00001", steelVendor.id, "2026-02-20", "2026-03-22", 85100, 11100, "MS plate GR match — mushak", apJe.id, po.lastInsertRowid, uid]
    );

    const agora = get("SELECT id FROM customers WHERE code = 'C-AGORA'");
    const so = run(
      "INSERT INTO sales_orders (so_number, customer_id, order_date, status, notes, created_by) VALUES (?,?,?,?,?,?)",
      ["SO-2026-00001", agora.id, "2026-02-15", "partial", "Agora fixture program — Dhaka metro", uid]
    );
    // Sell @ ৳14,500
    run("INSERT INTO so_lines (so_id, line_no, material_id, qty, unit_price_cents, qty_delivered, qty_billed) VALUES (?,1,?,?,?,4,0)", [
      so.lastInsertRowid, widget.id, 10, 1450000,
    ]);

    // COGS 4 × ৳8,200 = ৳32,800
    const dnJe = postJournal(db, {
      date: "2026-02-21", postingDate: "2026-02-21", sourceModule: "SD", sourceId: "DN-2026-00001",
      description: "Delivery DN-2026-00001 for SO-2026-00001 (Agora)", userId: uid,
      lines: [
        { accountCode: "5000", debit: 32800, text: "COGS Unit A × 4" },
        { accountCode: "1300", credit: 32800, text: "FG issue Tejgaon" },
      ],
    });
    const del = run(
      "INSERT INTO deliveries (delivery_no, so_id, delivery_date, status, journal_id, created_by) VALUES (?,?,?,'posted',?,?)",
      ["DN-2026-00001", so.lastInsertRowid, "2026-02-21", dnJe.id, uid]
    );
    const soLine = get("SELECT id FROM so_lines WHERE so_id = ?", [so.lastInsertRowid]);
    run("INSERT INTO delivery_lines (delivery_id, so_line_id, material_id, qty, storage_location_id) VALUES (?,?,?,?,?)", [
      del.lastInsertRowid, soLine.id, widget.id, 4, locFg.id,
    ]);
    run("UPDATE inventory SET qty_on_hand = qty_on_hand - 4 WHERE material_id = ? AND storage_location_id = ?", [widget.id, locFg.id]);
    run(
      `INSERT INTO goods_movements (movement_no, movement_type, material_id, storage_location_id, qty, unit_cost_cents, ref_type, ref_id, journal_id, created_by)
       VALUES ('GI-2026-00001','GI',?,?,?,?,'DN','DN-2026-00001',?,?)`,
      [widget.id, locFg.id, 4, 820000, dnJe.id, uid]
    );

    const billNet = 4 * 14500;
    const billTax = billNet * 0.15;
    const billGross = billNet + billTax;
    const arJe = postJournal(db, {
      date: "2026-02-22", postingDate: "2026-02-22", sourceModule: "SD", sourceId: "SO-2026-00001",
      description: "Mushak / tax invoice SO-2026-00001 (Agora)", userId: uid,
      lines: [
        { accountCode: "1200", debit: billGross, text: "AR Agora Limited" },
        { accountCode: "4000", credit: billNet, text: "Sales Unit A × 4" },
        { accountCode: "2300", credit: billTax, text: "Output VAT 15% (NBR)" },
      ],
    });
    run("UPDATE so_lines SET qty_billed = 4 WHERE id = ?", [soLine.id]);
    run(
      `INSERT INTO ar_invoices (invoice_no, customer_id, invoice_date, due_date, amount_cents, tax_cents, description, status, journal_id, created_by)
       VALUES (?,?,?,?,?,?,?,'open',?,?)`,
      ["AR-2026-00001", agora.id, "2026-02-22", "2026-03-24", Math.round(billGross * 100), Math.round(billTax * 100), "Tax invoice SO-2026-00001", arJe.id, uid]
    );

    const faJe = postJournal(db, {
      date: "2025-09-15", postingDate: "2025-09-15", sourceModule: "FICO", sourceId: "ASSET",
      description: "Acquire CNC mill — Tejgaon plant", userId: uid,
      lines: [
        { accountCode: "1500", debit: 4200000, text: "CNC mill (imported)" },
        { accountCode: "1100", credit: 4200000, text: "Paid from DBBL current" },
      ],
    });
    run(
      `INSERT INTO fixed_assets (code, name, asset_class, acquisition_date, acquisition_cents, useful_life_months, journal_id, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      ["FA-2026-00001", "CNC milling machine — Tejgaon", "machinery", "2025-09-15", 420000000, 84, faJe.id, uid]
    );

    run(
      `INSERT INTO production_orders (po_number, material_id, work_center_id, qty_planned, qty_produced, status, start_date, due_date, notes, created_by)
       VALUES (?,?,?,?,0,'released',?,?,?,?)`,
      ["PR-2026-00001", widget.id, wcAsm.id, 20, "2026-02-20", "2026-03-15", "Build ahead for Agora Dhaka orders", uid]
    );

    run(`INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, after_json) VALUES (?,?,?,?,?,?)`, [
      uid, "admin@byapar.local", "SEED", "system", "demo",
      JSON.stringify({ company: "Jomadder Global Trade", currency: "BDT", fy: "2025-26", city: "Dhaka" }),
    ]);

    const bump = (name, val) => run("UPDATE sequences SET next_val = ? WHERE name = ?", [val, name]);
    bump("JOURNAL", 8);
    bump("PO", 2); bump("GR", 2); bump("GI", 2);
    bump("AP_INV", 2); bump("AR_INV", 2); bump("ASSET", 2);
    bump("VENDOR", 4); bump("CUSTOMER", 4); bump("MATERIAL", 7);
    bump("SO", 2); bump("DN", 2); bump("PROD", 2);

    // Lock early FY months after historical seed postings (period-lock demo).
    for (const code of ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12"]) {
      run("UPDATE fiscal_periods SET status = 'closed' WHERE code = ?", [code]);
    }
  });

  return true;
}
