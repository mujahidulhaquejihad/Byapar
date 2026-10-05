import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = path.join(__dirname, "..", "data");
export const DB_PATH = process.env.ERP_DB_PATH || path.join(DATA_DIR, "erp_bd.sqlite");

let db;

export function getDb() {
  if (!db) throw new Error("Database not opened");
  return db;
}

export function openDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
  return db;
}

export function tx(fn) {
  const d = getDb();
  d.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(d);
    d.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      d.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export function all(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

export function get(sql, params = []) {
  return getDb().prepare(sql).get(...params);
}

export function run(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

export function cents(n) {
  return Math.round(Number(n) * 100);
}

export function money(centsVal) {
  return Math.round(Number(centsVal || 0)) / 100;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function nextNumber(name) {
  const row = get("SELECT prefix, next_val FROM sequences WHERE name = ?", [name]);
  if (!row) throw new Error(`Unknown sequence ${name}`);
  const year = new Date().getFullYear();
  const num = `${row.prefix}-${year}-${String(row.next_val).padStart(5, "0")}`;
  run("UPDATE sequences SET next_val = next_val + 1 WHERE name = ?", [name]);
  return num;
}
