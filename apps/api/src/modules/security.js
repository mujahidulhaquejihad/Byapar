import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { all, get, run, tx } from "../db.js";
import { audit } from "../audit.js";
import { signToken, loadUser, requirePermission } from "../auth.js";

export const securityRouter = Router();

// ponytail: failed-login counter lives in memory — resets on restart and is per-process; move to a table if you run several API processes.
const failures = new Map();
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
export function loginLocked(key, now = Date.now()) {
  const f = failures.get(key);
  return f && f.count >= MAX_FAILS && now < f.until ? Math.ceil((f.until - now) / 60000) : 0;
}
export function recordLoginFailure(key, now = Date.now()) {
  const f = failures.get(key);
  failures.set(key, { count: f && now < f.until ? f.count + 1 : 1, until: now + LOCK_MS });
}
export const clearLoginFailures = (key) => failures.delete(key);

const bumpTokenVersion = (userId) => run("UPDATE users SET token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?", [userId]);

securityRouter.post("/auth/login", (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email and password required" });
  const email = parsed.data.email.toLowerCase();
  const key = email;
  const wait = loginLocked(key);
  if (wait) return res.status(429).json({ error: `Too many failed attempts — try again in ${wait} minute${wait > 1 ? "s" : ""}` });
  const aliases = [email];
  if (email.endsWith("@byapar.local")) aliases.push(email.replace("@byapar.local", "@erpsoft.local"));
  if (email.endsWith("@erpsoft.local")) aliases.push(email.replace("@erpsoft.local", "@byapar.local"));
  let user = null;
  for (const e of aliases) {
    user = get("SELECT * FROM users WHERE email = ?", [e]);
    if (user) break;
  }
  if (!user || user.status !== "active" || !bcrypt.compareSync(parsed.data.password, user.password_hash)) {
    recordLoginFailure(key);
    return res.status(401).json({ error: "Invalid email or password" });
  }
  clearLoginFailures(key);
  const profile = loadUser(user.id);
  audit(req, { action: "LOGIN", entityType: "user", entityId: user.id, after: { email: user.email } });
  res.json({ token: signToken(user), user: profile });
});

securityRouter.get("/auth/me", (req, res) => {
  res.json({ user: req.user });
});

securityRouter.post("/auth/change-password", (req, res) => {
  const parsed = z
    .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8, "New password must be at least 8 characters") })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const user = get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!bcrypt.compareSync(parsed.data.currentPassword, user.password_hash)) return res.status(400).json({ error: "Current password is wrong" });
  if (parsed.data.currentPassword === parsed.data.newPassword) return res.status(400).json({ error: "New password must differ from the current one" });
  run("UPDATE users SET password_hash = ? WHERE id = ?", [bcrypt.hashSync(parsed.data.newPassword, 10), user.id]);
  bumpTokenVersion(user.id);
  audit(req, { action: "CHANGE_PASSWORD", entityType: "user", entityId: user.id });
  res.json({ ok: true, token: signToken(user) });
});

securityRouter.post("/users/:id/reset-password", requirePermission("security.users.write"), (req, res) => {
  const parsed = z.object({ newPassword: z.string().min(8, "Password must be at least 8 characters") }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const user = get("SELECT id, email FROM users WHERE id = ?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "User not found" });
  run("UPDATE users SET password_hash = ? WHERE id = ?", [bcrypt.hashSync(parsed.data.newPassword, 10), user.id]);
  bumpTokenVersion(user.id);
  clearLoginFailures(user.email);
  audit(req, { action: "RESET_PASSWORD", entityType: "user", entityId: user.id, after: { email: user.email } });
  res.json({ ok: true });
});

securityRouter.post("/users/:id/status", requirePermission("security.users.write"), (req, res) => {
  const parsed = z.object({ status: z.enum(["active", "disabled"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "status must be active or disabled" });
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: "You cannot disable your own account" });
  const user = get("SELECT id, email FROM users WHERE id = ?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "User not found" });
  run("UPDATE users SET status = ? WHERE id = ?", [parsed.data.status, user.id]);
  bumpTokenVersion(user.id);
  audit(req, { action: parsed.data.status === "active" ? "ENABLE" : "DISABLE", entityType: "user", entityId: user.id, after: { email: user.email } });
  res.json({ ok: true });
});

securityRouter.get("/users", requirePermission("security.users.read"), (_req, res) => {
  const users = all("SELECT id, email, name, status, created_at FROM users ORDER BY id");
  const rows = users.map((u) => ({
    ...u,
    roles: all(
      `SELECT r.code FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?`,
      [u.id]
    ).map((r) => r.code),
  }));
  res.json({ users: rows });
});

securityRouter.post("/users", requirePermission("security.users.write"), (req, res) => {
  const parsed = z
    .object({
      email: z.string().email(),
      name: z.string().min(1),
      password: z.string().min(8),
      roles: z.array(z.string()).default(["VIEWER"]),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const created = tx(() => {
      const result = run("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)", [
        parsed.data.email.toLowerCase(),
        parsed.data.name,
        bcrypt.hashSync(parsed.data.password, 10),
      ]);
      for (const code of parsed.data.roles) {
        const role = get("SELECT id FROM roles WHERE code = ?", [code]);
        if (role) run("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [result.lastInsertRowid, role.id]);
      }
      return Number(result.lastInsertRowid);
    });
    const user = loadUser(created);
    audit(req, { action: "CREATE", entityType: "user", entityId: created, after: user });
    res.status(201).json({ user });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) return res.status(409).json({ error: "Email already exists" });
    throw err;
  }
});

securityRouter.get("/roles", requirePermission("security.users.read"), (_req, res) => {
  const roles = all("SELECT * FROM roles ORDER BY id").map((r) => ({
    ...r,
    permissions: all(
      `SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id WHERE rp.role_id = ?`,
      [r.id]
    ).map((p) => p.code),
  }));
  res.json({ roles, permissions: all("SELECT * FROM permissions ORDER BY module, code") });
});

securityRouter.get("/audit", requirePermission("security.audit.read"), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json({
    entries: all("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", [limit]),
  });
});
