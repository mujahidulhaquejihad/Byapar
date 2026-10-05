import { useState } from "react";
import { api, savedUser, setSession } from "../api.js";
import { Button, Field, Page } from "../ui.jsx";

export default function Account() {
  const user = savedUser();
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function save(e) {
    e.preventDefault();
    setMsg("");
    if (f.newPassword !== f.confirm) return setErr("New passwords do not match");
    try {
      const r = await api("/auth/change-password", { method: "POST", body: { currentPassword: f.currentPassword, newPassword: f.newPassword } });
      setSession(r.token, user);
      setErr("");
      setMsg("Password changed. Every other device and browser has been signed out.");
      setF({ currentPassword: "", newPassword: "", confirm: "" });
    } catch (e2) {
      setErr(e2.message);
    }
  }

  return (
    <Page title="My account" subtitle={`${user?.name} · ${user?.email} · ${(user?.roles || []).join(", ")}`}>
      {err ? <div className="err">{err}</div> : null}
      {msg ? <div className="okmsg">{msg}</div> : null}
      <div className="panel" style={{ maxWidth: 480 }}>
        <div className="panel-h">Change password</div>
        <form className="panel-b form" onSubmit={save}>
          <Field label="Current password">
            <input type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
          </Field>
          <Field label="New password (min 8 characters)">
            <input type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
          </Field>
          <Field label="Confirm new password">
            <input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
          </Field>
          <Button type="submit">Change password</Button>
        </form>
      </div>
    </Page>
  );
}
