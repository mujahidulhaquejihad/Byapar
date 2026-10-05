import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { migrate } from "./migrate.js";
import { seedIfEmpty } from "./seed.js";
import { authRequired, requirePermission } from "./auth.js";
import { securityRouter } from "./modules/security.js";
import { ficoRouter } from "./modules/fico.js";
import { mmRouter } from "./modules/mm.js";
import { sdRouter } from "./modules/sd.js";
import { ppRouter } from "./modules/pp.js";
import { extrasRouter } from "./modules/extras.js";
import { hrRouter } from "./modules/hr.js";
import { dashboard, pnlReport, balanceSheet, cashFlow } from "./dashboard.js";
import { startBackupSchedule } from "./backup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8082;

openDb();
migrate();
const seeded = seedIfEmpty();
startBackupSchedule();

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/v1/health", (_req, res) => {
  res.json({ ok: true, product: "Byapar", modules: ["SEC", "FICO", "MM", "SD", "PP", "OPS"], currency: "BDT", seeded });
});

app.use("/api/v1", (req, res, next) => {
  if (req.method === "POST" && req.path === "/auth/login") return next();
  return authRequired(req, res, next);
});

app.use("/api/v1", securityRouter);
app.use("/api/v1/fico", ficoRouter);
app.use("/api/v1/mm", mmRouter);
app.use("/api/v1/sd", sdRouter);
app.use("/api/v1/pp", ppRouter);
app.use("/api/v1/ops", extrasRouter);
app.use("/api/v1/hr", hrRouter);

app.get("/api/v1/dashboard", requirePermission("dashboard.read"), (_req, res) => {
  res.json(dashboard());
});

const isoDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s : undefined);
app.get("/api/v1/reports/pnl", requirePermission("reports.read", "fico.gl.read"), (req, res) => {
  res.json(pnlReport(isoDate(req.query.from), isoDate(req.query.to)));
});
app.get("/api/v1/reports/balance-sheet", requirePermission("reports.read", "fico.gl.read"), (req, res) => {
  res.json(balanceSheet(isoDate(req.query.asOf)));
});
app.get("/api/v1/reports/cash-flow", requirePermission("reports.read", "fico.gl.read"), (req, res) => {
  res.json(cashFlow(isoDate(req.query.from), isoDate(req.query.to)));
});

app.get("/api/v1/help/search", (req, res) => {
  const q = String(req.query.q || "").toLowerCase();
  const articles = [
    { id: "flow", title: "End-to-end (Bangladesh)", body: "Buy from local vendors (MM) → Make at Tejgaon (PP) → Sell domestically (SD) → Collect in BDT. VAT 15% posts to NBR VAT control." },
    { id: "gl", title: "General ledger in Taka", body: "All amounts are Bangladeshi Taka (৳). One posting service owns journals; debits must equal credits." },
    { id: "vat", title: "VAT / Mushak 15%", body: "Purchase invoices book input VAT; sales tax invoices book output VAT on account 2300 (NBR). Net payable appears on the trial balance." },
    { id: "po-gr", title: "Purchase to stock", body: "Create a PO (e.g. BSRM MS plate), then Receive. Inventory rises; GL posts Dr Inventory / Cr GR/IR." },
    { id: "otc", title: "Order to cash", body: "Sales order → Deliver from FG → Tax invoice (AR + revenue + VAT) → Receive payment to DBBL." },
    { id: "pp", title: "Production confirm", body: "BOM consumes MS plate, bolts, enamel. Confirm receipts finished goods at Tejgaon." },
    { id: "demo", title: "Demo logins", body: "admin@byapar.local / Admin@2027. Also accountant, buyer, sales, planner — password Demo@2027." },
  ];
  const hits = q ? articles.filter((a) => `${a.title} ${a.body}`.toLowerCase().includes(q)) : articles;
  res.json({ articles: hits });
});

const webDist = path.join(__dirname, "..", "..", "web", "dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

app.listen(PORT, () => {
  console.log(`Byapar API listening on http://localhost:${PORT}`);
  if (seeded) console.log("Demo company seeded: Jomadder Global Trade");
  console.log("Login: admin@byapar.local / Admin@2027");
});
