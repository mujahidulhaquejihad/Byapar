import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Page, useApi } from "../ui.jsx";

export default function RoleHome() {
  const { data, error, loading } = useApi(() => api("/ops/role-home"));
  if (loading) return <p className="muted">Loading desk…</p>;
  if (error) return <div className="err">{error}</div>;
  return (
    <Page title={`My desk — ${data.user}`} subtitle={`Roles: ${(data.roles || []).join(", ")}. Shortcuts for your daily queue.`}>
      <div className="grid-2">
        {(data.cards || []).map((c) => (
          <div className="panel" key={c.role}>
            <div className="panel-h">{c.role}</div>
            <div className="panel-b grid-3">
              {c.items.map((i) => (
                <Link key={i.label} to={i.to} className="stat-tile">
                  <div className="n">{i.value}</div>
                  <div className="t">{i.label}</div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}
