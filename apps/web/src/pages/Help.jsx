import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Button, Field, Page } from "../ui.jsx";

export default function Help() {
  const [q, setQ] = useState("");
  const [articles, setArticles] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/help/search?q=").then((d) => setArticles(d.articles)).catch((e) => setError(e.message));
  }, []);

  async function search(e) {
    e?.preventDefault();
    try {
      const data = await api(`/help/search?q=${encodeURIComponent(q)}`);
      setArticles(data.articles);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Page title="Help assistant" subtitle="Phase 1 ships contextual help only. An LLM copilot with tool-calling is deferred to Phase 3 until RBAC and audit are proven.">
      <form className="panel panel-b form" onSubmit={search} style={{ marginBottom: 16 }}>
        <Field label="Search how Byapar works">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. goods receipt, trial balance, demo login" />
        </Field>
        <Button type="submit">Search</Button>
      </form>
      {error ? <div className="err">{error}</div> : null}
      <div className="help-list">
        {(articles.length ? articles : []).map((a) => (
          <div className="help-item" key={a.id}>
            <h3>{a.title}</h3>
            <p>{a.body}</p>
          </div>
        ))}
      </div>
      {!articles.length ? (
        <p className="muted">Try “GL”, “purchase order”, or “demo login”.</p>
      ) : null}
    </Page>
  );
}
