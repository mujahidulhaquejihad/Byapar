import { useState } from "react";
import { api } from "../api.js";
import { Badge, Button, Field, Modal, Page, Table, useApi } from "../ui.jsx";

export default function Users() {
  const { data, error, loading, reload, setError } = useApi(() => api("/users"));
  const roles = useApi(() => api("/roles"));
  const [open, setOpen] = useState(false);
  const [reset, setReset] = useState(null);
  const act = async (fn, after) => {
    try {
      await fn();
      after?.();
      reload();
    } catch (e) {
      setError(e.message);
    }
  };
  const [form, setForm] = useState({ email: "", name: "", password: "Demo@2027", roles: ["VIEWER"] });

  async function create() {
    try {
      await api("/users", { method: "POST", body: form });
      setOpen(false);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <p className="muted">Loading users…</p>;
  return (
    <Page title="Users & roles" subtitle="Security Core is first: authentication, RBAC, and audit logging wrap every later module." actions={<Button onClick={() => setOpen(true)}>New user</Button>}>
      {error ? <div className="err">{error}</div> : null}
      <Table
        columns={[
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "roles", label: "Roles", render: (r) => r.roles.map((x) => <Badge key={x}>{x}</Badge>) },
          { key: "status", label: "Status", render: (r) => <Badge kind={r.status === "active" ? "active" : "cancelled"}>{r.status}</Badge> },
          {
            key: "act",
            label: "",
            render: (r) => (
              <span className="row-actions">
                <Button kind="ghost" onClick={() => setReset({ id: r.id, email: r.email, newPassword: "" })}>
                  Reset password
                </Button>
                <Button kind="ghost" onClick={() => act(() => api(`/users/${r.id}/status`, { method: "POST", body: { status: r.status === "active" ? "disabled" : "active" } }))}>
                  {r.status === "active" ? "Disable" : "Enable"}
                </Button>
              </span>
            ),
          },
        ]}
        rows={data?.users || []}
      />
      {reset ? (
        <Modal
          title={`Reset password — ${reset.email}`}
          onClose={() => setReset(null)}
          footer={
            <Button onClick={() => act(() => api(`/users/${reset.id}/reset-password`, { method: "POST", body: { newPassword: reset.newPassword } }), () => setReset(null))}>
              Set new password
            </Button>
          }
        >
          <div className="form">
            <Field label="New password (min 8 characters)">
              <input type="text" autoComplete="off" value={reset.newPassword} onChange={(e) => setReset({ ...reset, newPassword: e.target.value })} />
            </Field>
          </div>
          <p className="muted">The user is signed out everywhere and must use this password next time. Tell them to change it from My account.</p>
        </Modal>
      ) : null}
      <div style={{ height: 16 }} />
      <Table
        columns={[
          { key: "code", label: "Role" },
          { key: "name", label: "Name" },
          { key: "description", label: "Description" },
          { key: "permissions", label: "Permissions", render: (r) => r.permissions.length },
        ]}
        rows={roles.data?.roles || []}
      />
      {open ? (
        <Modal
          title="Create user"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create}>Save</Button>
            </>
          }
        >
          <div className="form two">
            <Field label="Name">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Password">
              <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Role">
              <select value={form.roles[0]} onChange={(e) => setForm({ ...form, roles: [e.target.value] })}>
                {(roles.data?.roles || []).map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.code}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}
