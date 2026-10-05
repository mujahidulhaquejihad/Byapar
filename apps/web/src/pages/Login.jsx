import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setSession } from "../api.js";
import { Button, Field } from "../ui.jsx";

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@byapar.local");
  const [password, setPassword] = useState("Admin@2027");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api("/auth/login", { method: "POST", body: { email, password } });
      setSession(data.token, data.user);
      nav("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-hero">
        <div>
          <img className="login-logo" src="/byapar-logo.png" alt="Byapar" />
          <p className="lede">
            Buy, make, sell, and close the books in Bangladeshi Taka — built for Tejgaon plant floors and Dhaka finance desks.
          </p>
          <div className="login-modules">
            <span>Security</span>
            <span>FICO</span>
            <span>Materials</span>
            <span>Sales</span>
            <span>Production</span>
          </div>
        </div>
        <div className="login-foot">Jomadder Global Trade · Tejgaon, Dhaka · FY 2025–26 · BDT ৳</div>
      </div>
      <div className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <h2>Sign in</h2>
          <p className="sub">Demo company in Dhaka — amounts in Bangladeshi Taka (৳).</p>
          {error ? <div className="err">{error}</div> : null}
          <div className="form">
            <Field label="Email">
              <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </Field>
            <Field label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Enter workspace"}
            </Button>
          </div>
          <div className="login-hints">
            admin@byapar.local / Admin@2027
            <br />
            sales@ · buyer@ · planner@ · accountant@
            <br />
            password Demo@2027
          </div>
        </form>
      </div>
    </div>
  );
}
