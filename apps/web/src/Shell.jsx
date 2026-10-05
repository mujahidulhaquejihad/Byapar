import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { clearSession, savedUser } from "./api.js";
import { useLang } from "./i18n.jsx";

const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
    <path d={d} strokeLinecap="square" />
  </svg>
);

export default function Shell() {
  const user = savedUser();
  const nav = useNavigate();
  const { t, toggle } = useLang();

  const items = [
    {
      group: "Command",
      links: [
        { to: "/", label: t("overview"), icon: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" },
        { to: "/desk", label: t("roleHome"), icon: "M4 6h16v12H4z" },
        { to: "/reports", label: t("reports"), icon: "M4 19V5M8 19v-8M12 19v-5M16 19V8M20 19v-3" },
        { to: "/vat-return", label: t("vatReturn"), icon: "M12 3v18M5 8h14M5 16h14" },
        { to: "/aging", label: t("aging"), icon: "M4 20h4V10H4zM10 20h4V4h-4zM16 20h4v-7h-4z" },
        { to: "/ledgers", label: "Ledgers", icon: "M6 4h12v16H6z" },
      ],
    },
    {
      group: "Finance",
      links: [
        { to: "/accounts", label: t("accounts"), icon: "M4 6h16M4 12h16M4 18h10" },
        { to: "/journals", label: t("journals"), icon: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" },
        { to: "/trial-balance", label: t("trialBalance"), icon: "M12 3v18M5 8h14M5 16h14" },
        { to: "/cashbook", label: t("cashbook"), icon: "M3 7h18v10H3zM7 11h4" },
        { to: "/bank-rec", label: t("bankRec"), icon: "M3 10h18M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18M12 3l9 5H3z" },
        { to: "/ap", label: t("ap"), icon: "M12 8v8M8 12h8" },
        { to: "/ar", label: t("ar"), icon: "M4 12h16M12 4v16" },
        { to: "/assets", label: t("assets"), icon: "M4 20h16V9l-8-5-8 5v11z" },
        { to: "/payroll", label: t("payroll"), icon: "M3 7h18v10H3zM12 12h.01M7 12h.01M17 12h.01" },
        { to: "/partners", label: t("partners"), icon: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" },
        { to: "/periods", label: t("periods"), icon: "M8 7V3m8 4V3M3 11h18M5 7h14v12H5z" },
        { to: "/approvals", label: t("approvals"), icon: "M9 12l2 2 4-4M5 12a7 7 0 1014 0 7 7 0 00-14 0z" },
      ],
    },
    {
      group: "Materials",
      links: [
        { to: "/materials", label: t("materials"), icon: "M21 16V8l-9-5-9 5v8l9 5 9-5z" },
        { to: "/purchase-orders", label: t("purchaseOrders"), icon: "M7 4h10l1 4H6l1-4zM6 8h12v12H6z" },
        { to: "/lcs", label: t("lcs"), icon: "M2 16l4-8h12l4 8zM6 20h12" },
        { to: "/inventory", label: t("inventory"), icon: "M3 7h18M5 7v12h14V7" },
        { to: "/stock-valuation", label: t("stockValuation"), icon: "M4 20h16M7 16V9M12 16V5M17 16v-4" },
        { to: "/reorder", label: t("reorder"), icon: "M12 9v4M12 17h.01M10 3h4l1 2h5v14H4V5h5l1-2z" },
        { to: "/movements", label: t("movements"), icon: "M7 16l-4-4 4-4M17 8l4 4-4 4" },
        { to: "/lots", label: t("lots"), icon: "M4 7h16v10H4z" },
        { to: "/shop-floor", label: t("shopFloor"), icon: "M4 8h16v10H4zM8 8V5h8v3" },
      ],
    },
    {
      group: "Sales",
      links: [
        { to: "/quotations", label: t("quotations"), icon: "M6 3h9l4 4v14H6zM9 12h7M9 16h5" },
        { to: "/sales-orders", label: t("salesOrders"), icon: "M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01" },
        { to: "/deliveries", label: t("deliveries"), icon: "M3 7h13v10H3zM16 10h5l-2 7H16" },
        { to: "/gate-passes", label: t("gate"), icon: "M4 4h16v6H4zM8 14h8v6H8z" },
      ],
    },
    {
      group: "Production",
      links: [
        { to: "/boms", label: t("boms"), icon: "M12 3l9 4.5v9L12 21l-9-4.5v-9L12 3z" },
        { to: "/production", label: t("production"), icon: "M4 20h16M6 20V10l6-4 6 4v10" },
        { to: "/work-centers", label: t("workCenters"), icon: "M4 8h16v12H4zM8 8V5h8v3" },
        { to: "/mrp", label: t("mrp"), icon: "M4 6h16M4 12h10M4 18h7" },
      ],
    },
    {
      group: "System",
      links: [
        { to: "/users", label: t("users"), icon: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" },
        { to: "/audit", label: t("audit"), icon: "M12 8v4l3 3M12 22a10 10 0 110-20 10 10 0 010 20z" },
        { to: "/import-backup", label: t("importExport"), icon: "M12 3v12M8 11l4 4 4-4M4 19h16" },
        { to: "/help", label: t("help"), icon: "M12 18h.01M9.1 9a3 3 0 115.8 1c0 2-3 2-3 4" },
      ],
    },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src="/byapar-logo.png" alt="Byapar" />
          <small>বাংলাদেশ · BDT</small>
        </div>
        <nav className="nav">
          {items.map((g) => (
            <div key={g.group}>
              <div className="nav-label">{g.group}</div>
              {g.links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.to === "/"}>
                  <Icon d={l.icon} />
                  {l.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <NavLink className="userbox" to="/account" title={t("account")}>
          <b>{user?.name}</b>
          <span>{user?.email}</span>
          <div className="roles">{(user?.roles || []).join(" · ")}</div>
        </NavLink>
      </aside>
      <div className="main">
        <header className="shell">
          <div className="shell-title">
            <span className="dot" />
            Jomadder Global Trade
          </div>
          <div className="shell-meta">
            <span>FY 2025–26</span>
            <span>BDT ৳</span>
            <button className="btn ghost" type="button" onClick={toggle}>
              {t("lang")}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                clearSession();
                nav("/login");
              }}
            >
              {t("signOut")}
            </button>
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
