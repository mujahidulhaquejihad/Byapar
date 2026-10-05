import { useEffect, useState } from "react";
import { api } from "./api.js";

/** Cash, bank and bKash / Nagad accounts (GL 1000–1199). */
export function CashAccountSelect({ value, onChange }) {
  const { data } = useApi(() => api("/fico/cash-accounts"));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {(data?.accounts || []).map((a) => (
        <option key={a.code} value={a.code}>
          {a.code} {a.name}
        </option>
      ))}
    </select>
  );
}

export function Page({ title, subtitle, actions, children }) {
  return (
    <div>
      <div className="page-h">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="row-actions">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Badge({ children, kind }) {
  return <span className={`badge ${kind || children}`}>{children}</span>;
}

export function Button({ children, onClick, kind = "primary", type = "button", disabled }) {
  return (
    <button className={`btn ${kind === "ghost" ? "ghost" : ""} ${kind === "danger" ? "danger" : ""}`} type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Field({ label, children, full }) {
  return (
    <div className={`field ${full ? "full" : ""}`}>
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Panel({ title, actions, children }) {
  return (
    <div className="panel">
      {title ? (
        <div className="panel-h">
          <span>{title}</span>
          {actions || null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function Table({ columns, rows, empty = "No records" }) {
  return (
    <div className="panel">
      <table className="data">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.num ? "num" : ""}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!(rows || []).length ? (
            <tr>
              <td colSpan={columns.length} className="muted">
                {empty}
              </td>
            </tr>
          ) : (
            (rows || []).map((row, i) => (
              <tr key={row.id ?? i}>
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? "num" : c.mono ? "mono" : ""}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <h2>{title}</h2>
          <Button kind="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="modal-b">{children}</div>
        {footer ? <div className="modal-f">{footer}</div> : null}
      </div>
    </div>
  );
}

export function useApi(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = () => {
    setLoading(true);
    loader()
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(reload, deps);
  return { data, error, loading, reload, setError };
}
