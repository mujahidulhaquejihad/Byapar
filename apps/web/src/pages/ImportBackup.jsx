import { useState } from "react";
import { api, download, parseCsv } from "../api.js";
import { Button, Field, Page, Table, useApi } from "../ui.jsx";

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

export default function ImportBackup() {
  const [csv, setCsv] = useState("sku,name,type,uom,stdPrice,reorderMin,reorderMax\nMAT-DEMO,Demo rod,raw,KG,200,100,2000");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const backups = useApi(() => api("/ops/backups"));
  const [dir, setDir] = useState(null);

  const run = (fn, ok) =>
    fn()
      .then((r) => {
        setErr("");
        if (ok) setMsg(ok(r));
        backups.reload();
      })
      .catch((e) => setErr(e.message));

  const doImport = () =>
    run(
      () =>
        api("/ops/import/materials", {
          method: "POST",
          body: {
            rows: parseCsv(csv).map((o) => ({
              sku: o.sku,
              name: o.name,
              type: o.type || "raw",
              uom: o.uom || "EA",
              stdPrice: Number(o.stdprice) || 0,
              reorderMin: Number(o.reordermin) || 0,
              reorderMax: Number(o.reordermax) || 0,
            })),
          },
        }),
      (r) => `Imported/updated — created ${r.created} new materials`
    );

  const b = backups.data;
  return (
    <Page title="Import / backup" subtitle="Automatic daily backups, manual download, audit CSV and materials import.">
      {err ? <div className="err">{err}</div> : null}
      {msg ? <div className="okmsg">{msg}</div> : null}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-h">Automatic backups</div>
        <div className="panel-b form">
          {backups.error ? <p className="muted">{backups.error}</p> : null}
          {b ? (
            <>
              <p className="muted" style={{ margin: 0 }}>
                A snapshot is taken every 24 hours while the API runs; the newest {b.keep} are kept. Last backup:{" "}
                <b>{b.lastBackupAt ? new Date(b.lastBackupAt).toLocaleString() : "never"}</b>
              </p>
              {b.sameDriveAsDb ? (
                <div className="err" style={{ margin: 0 }}>
                  Backups are on the same drive as the database — if that drive fails you lose both. Choose a folder on another drive, USB disk or a synced
                  cloud folder (Google Drive / OneDrive).
                </div>
              ) : null}
              <Field label="Backup folder" full>
                <input value={dir ?? b.dir} onChange={(e) => setDir(e.target.value)} />
              </Field>
              <div className="row-actions">
                {dir != null && dir !== b.dir ? (
                  <Button onClick={() => run(() => api("/ops/backups/settings", { method: "PUT", body: { dir } }), () => (setDir(null), "Backup folder saved"))}>
                    Save folder
                  </Button>
                ) : null}
                <Button kind="ghost" onClick={() => run(() => api("/ops/backups/run", { method: "POST" }), (r) => `Backup written to ${r.file}`)}>
                  Back up now
                </Button>
                <Button kind="ghost" onClick={() => run(() => download("/ops/backup", "byapar-backup.sqlite"))}>
                  Download a copy
                </Button>
                <Button kind="ghost" onClick={() => run(() => download("/ops/export/audit", "audit.csv"))}>
                  Export audit CSV
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </div>
      {b?.backups?.length ? (
        <Table
          columns={[
            { key: "name", label: "Backup file", mono: true },
            { key: "size", label: "Size", num: true, render: (r) => mb(r.size) },
          ]}
          rows={b.backups.map((x) => ({ ...x, id: x.name }))}
        />
      ) : null}
      <p className="muted">
        To restore: stop Byapar, copy a backup file over <code>apps/api/data/erp_bd.sqlite</code> (delete the <code>-wal</code> / <code>-shm</code> files next to
        it), then start again.
      </p>
      <div className="panel">
        <div className="panel-h">Import materials (CSV)</div>
        <div className="panel-b form">
          <Field label="CSV" full>
            <textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} style={{ fontFamily: "var(--mono)", fontSize: 12 }} />
          </Field>
          <Button onClick={doImport}>Import materials</Button>
        </div>
      </div>
    </Page>
  );
}
