import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { all, get, run } from "./db.js";

let secret = process.env.JWT_SECRET;
/** Per-install random secret persisted in app_settings (env JWT_SECRET overrides). */
function jwtSecret() {
  if (secret) return secret;
  secret = get("SELECT value FROM app_settings WHERE key = 'jwt_secret'")?.value;
  if (!secret) {
    secret = crypto.randomBytes(32).toString("hex");
    run("INSERT INTO app_settings (key, value) VALUES ('jwt_secret', ?)", [secret]);
  }
  return secret;
}

/** Token carries the user's token_version; bumping it (password change, reset, disable) ends every older session. */
export function signToken(user) {
  const tv = get("SELECT token_version FROM users WHERE id = ?", [user.id])?.token_version ?? 0;
  return jwt.sign({ sub: user.id, email: user.email, tv }, jwtSecret(), { expiresIn: "12h" });
}

export function loadUser(id) {
  const user = get("SELECT id, email, name, status, token_version FROM users WHERE id = ?", [id]);
  if (!user || user.status !== "active") return null;
  const roles = all(
    `SELECT r.code, r.name FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?`,
    [id]
  );
  const permissions = all(
    `SELECT DISTINCT p.code FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN user_roles ur ON ur.role_id = rp.role_id
     WHERE ur.user_id = ?`,
    [id]
  ).map((p) => p.code);
  return { ...user, roles: roles.map((r) => r.code), permissions };
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const payload = jwt.verify(token, jwtSecret());
    const user = loadUser(payload.sub);
    if (!user) return res.status(401).json({ error: "User inactive or not found" });
    if ((payload.tv ?? 0) !== user.token_version) return res.status(401).json({ error: "Session ended — please sign in again" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requirePermission(...codes) {
  return (req, res, next) => {
    const perms = req.user?.permissions || [];
    if (codes.some((c) => perms.includes(c))) return next();
    return res.status(403).json({ error: `Missing permission: ${codes.join(" or ")}` });
  };
}
