import { run } from "./db.js";

export function audit(req, { action, entityType, entityId, before, after }) {
  const actor = req.user;
  run(
    `INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, before_json, after_json, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actor?.id ?? null,
      actor?.email ?? null,
      action,
      entityType,
      entityId != null ? String(entityId) : null,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      req.ip || null,
    ]
  );
}
