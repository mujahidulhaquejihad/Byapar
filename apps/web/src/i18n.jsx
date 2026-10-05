import { createContext, useContext, useMemo, useState } from "react";

const dict = {
  en: {
    overview: "Overview",
    roleHome: "My desk",
    reports: "Financial statements",
    vatReturn: "VAT return",
    aging: "AR/AP aging",
    cashbook: "Cash & bank",
    periods: "Period lock",
    approvals: "Approvals",
    reorder: "Stock alerts",
    mrp: "MRP run",
    lots: "Lots / batches",
    gate: "Gate passes",
    importExport: "Import / backup",
    shopFloor: "Shop floor GR/GI",
    accounts: "Chart of accounts",
    journals: "Journal entries",
    trialBalance: "Trial balance",
    ap: "Accounts payable",
    ar: "Accounts receivable",
    bankRec: "Bank reconciliation",
    stockValuation: "Stock valuation",
    quotations: "Quotes & price lists",
    lcs: "Import LCs",
    payroll: "Payroll",
    account: "My account",
    assets: "Fixed assets",
    partners: "Partners",
    materials: "Material master",
    purchaseOrders: "Purchase orders",
    inventory: "Inventory",
    movements: "Movements",
    salesOrders: "Sales orders",
    deliveries: "Deliveries",
    boms: "Bills of materials",
    production: "Production orders",
    workCenters: "Work centers",
    users: "Users & roles",
    audit: "Audit log",
    help: "Ops guide",
    signOut: "Sign out",
    lang: "বাংলা",
  },
  bn: {
    overview: "ওভারভিউ",
    roleHome: "আমার ডেস্ক",
    reports: "আর্থিক বিবরণী",
    vatReturn: "ভ্যাট রিটার্ন",
    aging: "বকেয়া বিশ্লেষণ",
    cashbook: "নগদ ও ব্যাংক",
    periods: "পিরিয়ড লক",
    approvals: "অনুমোদন",
    reorder: "স্টক সতর্কতা",
    mrp: "এমআরপি",
    lots: "লট / ব্যাচ",
    gate: "গেট পাস",
    importExport: "ইমপোর্ট / ব্যাকআপ",
    shopFloor: "গোডাউন GR/GI",
    accounts: "খতিয়ান",
    journals: "জার্নাল",
    trialBalance: "ট্রায়াল ব্যালেন্স",
    ap: "পাওনাদার",
    ar: "দেনাদার",
    bankRec: "ব্যাংক মিলকরণ",
    stockValuation: "মজুদ মূল্যায়ন",
    quotations: "কোটেশন ও মূল্য তালিকা",
    lcs: "আমদানি এলসি",
    payroll: "বেতন",
    account: "আমার অ্যাকাউন্ট",
    assets: "স্থায়ী সম্পদ",
    partners: "পার্টনার",
    materials: "মালামাল",
    purchaseOrders: "ক্রয় আদেশ",
    inventory: "মজুদ",
    movements: "মালামাল চলাচল",
    salesOrders: "বিক্রয় আদেশ",
    deliveries: "ডেলিভারি",
    boms: "উপাদান তালিকা",
    production: "উৎপাদন আদেশ",
    workCenters: "ওয়ার্ক সেন্টার",
    users: "ব্যবহারকারী",
    audit: "অডিট লগ",
    help: "সহায়িকা",
    signOut: "সাইন আউট",
    lang: "English",
  },
};

const LangCtx = createContext({ lang: "en", t: (k) => k, toggle: () => {} });

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem("byapar_lang") || localStorage.getItem("erpsoft_lang") || "en");
  const value = useMemo(
    () => ({
      lang,
      t: (key) => dict[lang][key] || dict.en[key] || key,
      toggle: () => {
        const next = lang === "en" ? "bn" : "en";
        localStorage.setItem("byapar_lang", next);
        setLang(next);
      },
    }),
    [lang]
  );
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useLang() {
  return useContext(LangCtx);
}
