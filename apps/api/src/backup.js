import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, get, run, DB_PATH } from "./db.js";

const KEEP = 14;
const setting = (key) => get("SELECT value FROM app_settings WHERE key = ?", [key])?.value;
const setSetting = (key, value) =>
  run("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [key, value]);

export const backupDir = () => setting("backup_dir") || path.join(os.homedir(), "Byapar Backups");

/** Consistent copy of the live (WAL) database, safe while the app is writing. */
export function snapshot(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  getDb().prepare("VACUUM INTO ?").run(file);
}

export function listBackups() {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^byapar-\d{4}-\d{2}-\d{2}-\d{6}\.sqlite$/.test(f))
    .sort()
    .reverse()
    .map((name) => ({ name, size: fs.statSync(path.join(dir, name)).size }));
}

export function runBackup() {
  const iso = new Date().toISOString();
  const file = path.join(backupDir(), `byapar-${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, "")}.sqlite`);
  snapshot(file);
  for (const old of listBackups().slice(KEEP)) fs.rmSync(path.join(backupDir(), old.name), { force: true });
  setSetting("last_backup_at", new Date().toISOString());
  return { file, size: fs.statSync(file).size };
}

export function setBackupDir(dir) {
  if (!path.isAbsolute(dir)) throw Object.assign(new Error("Backup folder must be a full path, e.g. D:\\Byapar Backups"), { status: 400 });
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.W_OK);
  setSetting("backup_dir", dir);
}

export function backupStatus() {
  const dir = backupDir();
  return {
    dir,
    keep: KEEP,
    lastBackupAt: setting("last_backup_at") || null,
    sameDriveAsDb: path.parse(path.resolve(dir)).root.toLowerCase() === path.parse(path.resolve(DB_PATH)).root.toLowerCase(),
    backups: listBackups(),
  };
}

/** Checks hourly; takes a backup when the last one is older than a day (or never ran). */
export function startBackupSchedule() {
  const tick = () => {
    try {
      const last = Date.parse(setting("last_backup_at") || 0);
      if (!(Date.now() - last < 24 * 3600 * 1000)) console.log(`[backup] wrote ${runBackup().file}`);
    } catch (err) {
      console.error(`[backup] failed: ${err.message}`);
    }
  };
  tick();
  setInterval(tick, 3600 * 1000).unref();
}
