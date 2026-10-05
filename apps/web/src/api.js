const TOKEN_KEY = "byapar_token";
const USER_KEY = "byapar_user";

function migrateLegacySession() {
  if (!localStorage.getItem(TOKEN_KEY) && localStorage.getItem("erpsoft_token")) {
    localStorage.setItem(TOKEN_KEY, localStorage.getItem("erpsoft_token"));
    localStorage.setItem(USER_KEY, localStorage.getItem("erpsoft_user") || "null");
    localStorage.removeItem("erpsoft_token");
    localStorage.removeItem("erpsoft_user");
  }
}
migrateLegacySession();

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function savedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearSession();
    if (!path.startsWith("/auth/login")) window.location.assign("/login");
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Fetches an authenticated file and saves it via the browser. */
export async function download(path, filename) {
  const res = await fetch(`/api/v1${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** CSV text → array of objects keyed by lower-cased header; handles quoted fields and "" escapes. */
export function parseCsv(text) {
  const rows = [[]];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") rows.at(-1).push(cell), (cell = "");
    else if (ch === "\n") rows.at(-1).push(cell.replace(/\r$/, "")), rows.push([]), (cell = "");
    else cell += ch;
  }
  rows.at(-1).push(cell);
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  const keys = (head || []).map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export const money = (n) =>
  new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 2,
  }).format(Number(n || 0));
