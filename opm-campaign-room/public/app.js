// OPM JPN campaign room — front end (no framework, no build step)

const S = {
  me: null, pages: null, page: null, items: [], route: "home",
  tab: "schedule", filter: "all", open: null, fresh: null, loading: true,
};
const app = document.getElementById("app");
const drawerRoot = document.getElementById("drawer-root");

// ---------------- helpers ----------------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "");
const D = (iso) => new Date(iso + "T00:00:00Z");
const fmt = (iso, o) => (iso ? D(iso).toLocaleDateString("en-GB", { timeZone: "UTC", ...o }) : "");
const dayDate = (iso) => fmt(iso, { weekday: "short", day: "numeric", month: "short" });
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = D(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const n0 = (n) => (n == null || n === "" ? "–" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }));
const money = (n, cur) => (n == null ? "–" : `${cur === "USD" ? "$" : cur === "LKR" ? "Rs " : cur === "JPY" ? "¥" : (cur || "") + " "}${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 })}`);
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "–");
const ratio = (a, b) => (b ? (a / b).toFixed(2) + "x" : "–");
const kind = (it) => (it.type === "post" ? "Post" : "Story");
const mediaSrc = (it) => (it.media ? `/api/app?action=media&id=${encodeURIComponent(it.id)}&v=${it.media.v}` : "");
const adminName = () => (S.page && S.page.adminName) || "the page admin";

const LABEL = {
  draft: "Draft", waiting: "Waiting for approval", approved: "Approved", changes: "Changes requested",
  rejected: "Rejected", posted: "Posted", cancelled: "Cancelled",
};

async function api(action, data = {}, method = "POST") {
  let res;
  if (method === "GET") {
    const q = new URLSearchParams({ action, ...data });
    res = await fetch("/api/app?" + q, { credentials: "same-origin" });
  } else {
    res = await fetch("/api/app", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...data }),
    });
  }
  const out = await res.json().catch(() => ({ error: "The server didn't answer. Check your connection and try again." }));
  if (res.status === 401 && action !== "login") { S.me = { role: null }; render(); }
  if (!res.ok || out.error) throw new Error(out.error || "Something went wrong.");
  return out;
}

let toastTimer;
function toast(msg, bad = false) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = "on" + (bad ? " bad" : "");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = bad ? "bad" : ""), bad ? 4200 : 2200);
}

function summarize(items, page) {
  const s = { total: 0, draft: 0, waiting: 0, approved: 0, changes: 0, rejected: 0, posted: 0, cancelled: 0, overdue: 0,
    reach: 0, clicks: 0, orders: 0, revenue: 0, cost: 0, interactions: 0 };
  for (const it of items) {
    s.total++; s[it.state]++;
    if (it.date < today() && !["posted", "cancelled"].includes(it.state)) s.overdue++;
    const m = it.metrics || {};
    s.reach += m.reach || 0; s.clicks += m.clicks || 0; s.orders += m.orders || 0; s.revenue += m.revenue || 0;
    s.cost += costOf(it, page);
    s.interactions += (m.likes || 0) + (m.comments || 0) + (m.shares || 0) + (m.saves || 0) + (m.replies || 0);
  }
  return s;
}
function costOf(it, page) {
  const m = it.metrics || {};
  if (m.cost != null) return m.cost;
  if (it.state !== "posted" || !page) return 0;
  return (it.type === "post" ? page.feePost : page.feeStory) || 0;
}

// ---------------- routing ----------------
function readHash() {
  const h = location.hash.replace(/^#/, "");
  if (h.startsWith("code=")) return { route: "home", code: decodeURIComponent(h.slice(5)) };
  const m = /^\/p\/([\w]+)(?:\/(schedule|results|settings))?/.exec(h);
  if (m) return { route: "page", id: m[1], tab: m[2] || "schedule" };
  return { route: "home" };
}
window.addEventListener("hashchange", () => go());
function nav(hash) { if (location.hash !== hash) location.hash = hash; else go(); }

async function go() {
  const r = readHash();
  if (!S.me || S.me.role === undefined) S.me = await api("me", {}, "GET").catch(() => ({ role: null }));
  if (!S.me.role) { S.loading = false; S.prefill = r.code || S.prefill; return render(); }
  if (S.me.role === "admin" && (r.route !== "page" || r.id !== S.me.pageId)) return nav(`#/p/${S.me.pageId}`);
  if (r.route === "page") {
    S.route = "page"; S.tab = r.tab;
    if (S.me.role !== "owner" && S.tab === "settings") S.tab = "schedule";
    if (!S.page || S.page.id !== r.id) { S.loading = true; render(); await loadPage(r.id); }
  } else {
    S.route = "home"; S.page = null; S.items = []; S.open = null; closeDrawer();
    S.loading = true; render();
    try { S.pages = (await api("overview", {}, "GET")).pages; } catch (e) { toast(e.message, true); }
  }
  S.loading = false; render();
}
async function loadPage(id) {
  try {
    const out = await api("page", { id }, "GET");
    S.page = out.page; S.items = out.items; S.filter = "all";
  } catch (e) { toast(e.message, true); S.page = null; if (S.me.role === "owner") nav("#/"); }
}

// ---------------- render ----------------
function render() {
  if (S.loading && !S.me) { app.innerHTML = ""; return; }
  if (!S.me || !S.me.role) { app.innerHTML = loginView(); bindLogin(); return; }
  const banner = S.me.local ? `<div class="banner">Preview mode: data is saved on this computer only. Connect Upstash Redis on Vercel to save it online.</div>` : "";
  let body = "";
  if (S.loading) body = `<p class="muted">Loading…</p>`;
  else if (S.route === "page" && S.page) body = pageView();
  else if (S.route === "home") body = overviewView();
  app.innerHTML = banner + topBar() + `<main id="main">${body}</main>`;
  if (S.open) renderDrawer();
}

function topBar() {
  const who = S.me.role === "owner" ? S.me.name : `${esc(S.me.name)}, admin of ${esc(S.page?.name || "your page")}`;
  return `<header class="top">
    <a class="brand" href="${S.me.role === "owner" ? "#/" : "#/p/" + esc(S.me.pageId)}">OPM JPN<span>Campaign room</span></a>
    <div class="who"><span class="muted">${who}</span><button class="btn sm" data-act="logout">Sign out</button></div>
  </header>`;
}

// ----- sign in -----
const markSvg = (k) => {
  if (k === "approved") return `<svg class="mark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><ellipse cx="50" cy="51" rx="44" ry="46" transform="rotate(-5 50 50)" vector-effect="non-scaling-stroke"/></svg>`;
  if (k === "rejected") return `<svg class="mark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M18 14 L84 88 M82 12 L16 86" vector-effect="non-scaling-stroke"/></svg>`;
  if (k === "changes") return `<svg class="mark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M14 84 q6 -7 12 0 t12 0 t12 0 t12 0 t12 0 t12 0" vector-effect="non-scaling-stroke"/></svg>`;
  return "";
};

function loginView() {
  return `<div class="signin">
    <section class="sheet">
      <div class="brand" style="font-size:20px">OPM JPN</div>
      <div>
        <h1 class="display">Campaign room</h1>
        <div class="demo-strip" aria-hidden="true"><i></i><i class="p">${markSvg("approved")}</i><i></i></div>
        <p>Plan posts and stories for each page, get them approved by the page admin, and track how they perform.</p>
      </div>
      <span></span>
    </section>
    <form id="login" autocomplete="off">
      <h2 style="font-size:28px">Sign in</h2>
      <label class="f">Access code
        <input id="code" type="password" name="code" required value="${esc(S.prefill || "")}" autocomplete="current-password" spellcheck="false">
        <span class="hint">Page admins: use the code you were sent. Owner: use your password.</span>
      </label>
      <label class="row small muted"><input type="checkbox" id="show"> Show code</label>
      <div id="login-err" class="err" role="alert"></div>
      <div><button class="btn solid" type="submit">Sign in</button></div>
    </form>
  </div>`;
}
function bindLogin() {
  const f = document.getElementById("login");
  document.getElementById("show").onchange = (e) => (document.getElementById("code").type = e.target.checked ? "text" : "password");
  if (S.prefill) document.getElementById("code").type = "text";
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector("button"); btn.disabled = true;
    try {
      await api("login", { code: document.getElementById("code").value.trim() });
      S.me = await api("me", {}, "GET"); S.prefill = "";
      history.replaceState(null, "", location.pathname);
      await go();
    } catch (err) { document.getElementById("login-err").textContent = err.message; btn.disabled = false; }
  };
}

// ----- owner overview -----
function overviewView() {
  const pages = S.pages || [];
  const t = { reach: 0, clicks: 0, orders: 0, revenue: 0, cost: 0, waiting: 0, posted: 0, total: 0 };
  for (const p of pages) for (const k in t) t[k] += p.summary[k] || 0;
  const cur = pages[0]?.currency || "USD";
  const starts = pages.map((p) => p.start).sort();
  const span = starts.length ? `${fmt(starts[0], { day: "numeric", month: "short" })} to ${fmt(addDays(starts[starts.length - 1], 90), { day: "numeric", month: "short", year: "numeric" })}` : "";
  const rows = pages.map((p) => {
    const s = p.summary;
    const weeks = [];
    for (let w = 0; w < 13; w++) {
      const cells = s.strip.slice(w * 3, w * 3 + 3).map((st, i) => `<i class="${i === 1 ? "p " : ""}s-${st}"></i>`).join("");
      weeks.push(`<span class="wk">${cells}</span>`);
    }
    const needs = [];
    if (s.waiting) needs.push(`${s.waiting} waiting for ${esc(p.adminName || "admin")}`);
    if (s.changes + s.rejected) needs.push(`${s.changes + s.rejected} to fix`);
    if (s.overdue) needs.push(`${s.overdue} overdue`);
    return `<a class="prow" href="#/p/${esc(p.id)}">
      <div>
        <div class="display pname">${esc(p.name)}</div>
        <div class="meta">${esc(p.handle || "")}${p.handle && p.adminName ? ", " : ""}${p.adminName ? "admin " + esc(p.adminName) : ""}</div>
        ${needs.length ? `<div class="needs">${needs.join(", ")}</div>` : ""}
      </div>
      <div><div class="mini" aria-label="${s.posted} of ${s.total} posted">${weeks.join("")}</div></div>
      <div class="nums num">
        <span><b>${s.posted}/${s.total}</b>posted</span>
        <span><b>${n0(s.reach)}</b>reach</span>
        <span><b>${n0(s.clicks)}</b>link clicks</span>
        <span><b>${n0(s.orders)}</b>orders</span>
        <span><b>${money(s.revenue, p.currency)}</b>revenue</span>
        <span><b>${ratio(s.revenue, s.cost)}</b>ROAS</span>
      </div>
    </a>`;
  }).join("");
  return `<div class="head">
      <div><h1 class="display">All pages</h1>${span ? `<p class="muted" style="margin:10px 0 0">${span}</p>` : ""}</div>
      <button class="btn solid" data-act="add-page">Add a page</button>
    </div>
    ${pages.length ? `
    <div class="figures num">
      <div class="fig"><b>${t.posted}/${t.total}</b><span>posted</span></div>
      <div class="fig"><b>${t.waiting}</b><span>waiting for approval</span></div>
      <div class="fig"><b>${n0(t.reach)}</b><span>reach</span></div>
      <div class="fig"><b>${n0(t.clicks)}</b><span>link clicks</span></div>
      <div class="fig"><b>${n0(t.orders)}</b><span>orders</span></div>
      <div class="fig"><b>${money(t.revenue, cur)}</b><span>revenue</span></div>
      <div class="fig"><b>${money(t.cost, cur)}</b><span>spent</span></div>
      <div class="fig"><b>${ratio(t.revenue, t.cost)}</b><span>ROAS</span></div>
    </div>
    <div class="pages">${rows}</div>
    <div class="legend"><span><i style="background:#333"></i>Draft</span><span><i style="background:#9A9A94"></i>Waiting</span><span><i style="background:var(--paper);box-shadow:inset 0 0 0 2px var(--marker)"></i>Approved</span><span><i style="background:var(--marker)"></i>Needs changes</span><span><i style="background:var(--paper);box-shadow:0 0 0 1px var(--ink)"></i>Posted</span></div>`
    : `<div class="empty"><h2>Add your first Instagram page</h2><p class="muted">Each page gets 13 weeks of slots (a story on Tuesday, a post on Thursday, a story on Saturday) and its own access code for the admin. Admins only ever see their own page.</p><button class="btn solid" data-act="add-page">Add a page</button></div>`}`;
}

function pageForm(p = {}) {
  const v = (k) => esc(p[k] ?? "");
  return `
    <div class="grid2">
      <label class="f">Page name<input type="text" name="name" required value="${v("name")}" placeholder="e.g. Carti Fits"></label>
      <label class="f">Instagram handle<input type="text" name="handle" value="${v("handle")}" placeholder="@handle"></label>
      <label class="f">Admin name<input type="text" name="adminName" value="${v("adminName")}"></label>
      <label class="f">Admin contact<input type="text" name="adminContact" value="${v("adminContact")}" placeholder="WhatsApp or email"></label>
      <label class="f">Week 1 starts<span class="hint">Pick a Monday. Stories go Tue and Sat, posts Thu.</span><input type="date" name="start" required value="${v("start") || nextMonday()}"></label>
      <label class="f">Currency<select name="currency">${["USD", "LKR", "JPY", "EUR"].map((c) => `<option ${p.currency === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <label class="f">Fee per post<input type="number" min="0" step="any" name="feePost" value="${v("feePost")}"></label>
      <label class="f">Fee per story<input type="number" min="0" step="any" name="feeStory" value="${v("feeStory")}"></label>
      <label class="f">Discount code<span class="hint">To match store orders to this page</span><input type="text" name="discountCode" value="${v("discountCode")}"></label>
      <label class="f">Default link<span class="hint">Pre-filled on every post and story</span><input type="url" name="link" value="${v("link")}" placeholder="https://opium00polo.com/?utm_source=..."></label>
      <label class="f">Followers at start<input type="number" min="0" name="followersStart" value="${v("followersStart")}"></label>
      <label class="f">Followers now<input type="number" min="0" name="followersNow" value="${v("followersNow")}"></label>
    </div>`;
}
function nextMonday() {
  const d = new Date(); const day = d.getDay(); d.setDate(d.getDate() + ((8 - day) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
function openAddPage() {
  const dlg = document.createElement("dialog");
  dlg.innerHTML = `<form method="dialog" class="stack" id="addp"><h2>Add a page</h2>${pageForm()}<div class="err" id="addp-err"></div>
    <div class="row"><button class="btn solid" value="ok">Add page</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div></form>`;
  document.body.appendChild(dlg); dlg.showModal();
  const f = dlg.querySelector("form");
  f.onsubmit = async (e) => {
    if (e.submitter?.value === "cancel") return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    try {
      const { page } = await api("createPage", data);
      dlg.close(); dlg.remove(); toast("Page added");
      nav(`#/p/${page.id}/settings`);
    } catch (err) { dlg.querySelector("#addp-err").textContent = err.message; }
  };
  dlg.addEventListener("close", () => dlg.remove());
}

// ----- page view -----
function pageView() {
  const p = S.page, owner = S.me.role === "owner";
  const s = summarize(S.items, p);
  const waitingCount = owner ? s.changes + s.rejected : s.waiting;
  const tabs = [["schedule", "Schedule"], ["results", "Results"]].concat(owner ? [["settings", "Page settings"]] : []);
  return `${owner ? `<a class="crumb" href="#/">All pages</a>` : ""}
    <div class="head" style="margin-bottom:0">
      <div>
        <h1 class="display">${esc(p.name)}</h1>
        <p class="muted" style="margin:10px 0 0">${[p.handle && esc(p.handle), p.adminName && "admin " + esc(p.adminName), `${fmt(p.start, { day: "numeric", month: "short" })} to ${fmt(addDays(p.start, 90), { day: "numeric", month: "short", year: "numeric" })}`].filter(Boolean).join(", ")}</p>
      </div>
      <div class="figures num" style="margin:0;border:0;padding:0">
        <div class="fig"><b>${s.approved + s.posted}/${s.total}</b><span>approved</span></div>
        <div class="fig"><b>${s.posted}</b><span>posted</span></div>
        <div class="fig"><b>${n0(s.reach)}</b><span>reach</span></div>
      </div>
    </div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${S.tab === k}" data-act="tab" data-tab="${k}">${l}${k === "schedule" && waitingCount ? `<span class="count">${waitingCount}</span>` : ""}</button>`).join("")}</div>
    ${S.tab === "results" ? resultsView(s) : S.tab === "settings" && owner ? settingsView() : scheduleView()}`;
}

function scheduleView() {
  const owner = S.me.role === "owner";
  const F = owner
    ? [["all", "All"], ["todo", "Needs work"], ["waiting", `Waiting for ${esc(adminName())}`], ["approved", "Approved"], ["posted", "Posted"]]
    : [["all", "All"], ["waiting", "Waiting for you"], ["approved", "Approved"], ["posted", "Posted"]];
  const match = (it) => {
    switch (S.filter) {
      case "todo": return ["draft", "changes", "rejected"].includes(it.state);
      case "waiting": return it.state === "waiting";
      case "approved": return it.state === "approved";
      case "posted": return it.state === "posted";
      default: return true;
    }
  };
  const t = today();
  const weeks = [];
  for (let w = 1; w <= 13; w++) {
    const items = S.items.filter((it) => it.week === w);
    if (!items.some(match)) continue;
    const ws = addDays(S.page.start, (w - 1) * 7);
    const now = t >= ws && t <= addDays(ws, 6);
    const notes = items.filter((it) => ["changes", "rejected"].includes(it.state)).map((it) => {
      const last = [...(it.thread || [])].reverse().find((m) => m.kind === it.state);
      return last?.text ? `<p><span class="hand">${esc(kind(it))}: ${esc(last.text)}</span></p>` : "";
    }).join("");
    weeks.push(`<section class="week${now ? " now" : ""}" aria-label="Week ${w}">
      <div class="label"><b>Week ${w}</b><span>${fmt(ws, { day: "numeric", month: "short" })} to ${fmt(addDays(ws, 6), { day: "numeric", month: "short" })}</span></div>
      <div class="film">${items.map((it) => frameHtml(it, match(it))).join("")}</div>
      <div class="notes">${notes}</div>
    </section>`);
  }
  return `<div class="filters" role="group" aria-label="Filter">${F.map(([k, l]) => `<button class="chip" aria-pressed="${S.filter === k}" data-act="filter" data-f="${k}">${l}</button>`).join("")}</div>
    <div class="weeks">${weeks.join("") || `<p class="muted">Nothing here right now.</p>`}</div>`;
}

function frameHtml(it, on = true) {
  const owner = S.me.role === "owner";
  const src = mediaSrc(it);
  const fresh = S.fresh === it.id ? " fresh" : "";
  let tag = "";
  if (it.state === "waiting") tag = `<span class="tag">${owner ? "With " + esc(adminName()) : "Review this"}</span>`;
  else if (it.state === "approved") tag = `<span class="tag hand">approved</span>`;
  else if (it.state === "changes") tag = `<span class="tag hand">fix this</span>`;
  else if (it.state === "rejected") tag = `<span class="tag hand">rejected</span>`;
  else if (it.state === "posted") tag = `<span class="tag dark">Posted</span>`;
  const blank = src ? `<img src="${src}" alt="" loading="lazy">`
    : it.caption ? `<span class="blank">${esc(it.caption.slice(0, 90))}</span>`
    : `<span class="blank"><b>${owner ? "Add" : "Not ready"}</b>${kind(it)}</span>`;
  return `<button class="frame ${it.type}${src ? " has-img" : ""}${it.caption ? " has-text" : ""}${it.state === "cancelled" ? " cancelled" : ""}" style="${on ? "" : "opacity:.25"}"
      data-act="open" data-id="${esc(it.id)}" aria-label="${kind(it)} ${dayDate(it.date)}, ${LABEL[it.state]}">
      ${blank}
      ${["approved", "changes", "rejected"].includes(it.state) ? markSvg(it.state).replace('class="mark"', `class="mark${fresh}"`) : ""}
      ${tag}
      <span class="cap"><span class="k">${kind(it)} </span>${dayDate(it.date)}</span>
    </button>`;
}

// ----- results -----
function resultsView(s) {
  const p = S.page;
  const weeks = Array.from({ length: 13 }, (_, i) => {
    const its = S.items.filter((it) => it.week === i + 1);
    return { w: i + 1, reach: its.reduce((a, it) => a + (it.metrics?.reach || 0), 0), clicks: its.reduce((a, it) => a + (it.metrics?.clicks || 0), 0) };
  });
  const posted = S.items.filter((it) => it.state === "posted");
  const posts = S.items.filter((it) => it.type === "post"), stories = S.items.filter((it) => it.type === "story");
  const sp = summarize(posts, p), ss = summarize(stories, p);
  const followers = p.followersStart != null && p.followersNow != null ? p.followersNow - p.followersStart : null;
  return `<div class="figures num" style="margin-top:0">
      <div class="fig"><b>${n0(s.reach)}</b><span>reach</span></div>
      <div class="fig"><b>${pct(s.interactions, s.reach)}</b><span>engagement</span></div>
      <div class="fig"><b>${n0(s.clicks)}</b><span>link clicks</span></div>
      <div class="fig"><b>${pct(s.clicks, s.reach)}</b><span>click rate</span></div>
      <div class="fig"><b>${n0(s.orders)}</b><span>orders</span></div>
      <div class="fig"><b>${money(s.revenue, p.currency)}</b><span>revenue</span></div>
      ${S.me.role === "owner" ? `<div class="fig"><b>${money(s.cost, p.currency)}</b><span>spent</span></div><div class="fig"><b>${ratio(s.revenue, s.cost)}</b><span>ROAS</span></div>` : ""}
      ${followers != null ? `<div class="fig"><b>${followers >= 0 ? "+" : ""}${n0(followers)}</b><span>followers</span></div>` : ""}
    </div>
    <div class="grid2" style="gap:32px">
      <div class="chart"><h3>Reach by week</h3>${bars(weeks, "reach", "var(--ink)")}</div>
      <div class="chart"><h3>Link clicks by week</h3>${bars(weeks, "clicks", "var(--marker)")}</div>
    </div>
    <h3>Posts and stories compared</h3>
    <div class="table-wrap" style="margin-bottom:28px"><table>
      <thead><tr><th></th><th>Posted</th><th>Avg reach</th><th>Engagement</th><th>Link clicks</th><th>Orders</th><th>Revenue</th></tr></thead>
      <tbody style="cursor:default">
        ${[["Posts", sp], ["Stories", ss]].map(([l, x]) => `<tr style="cursor:default"><td>${l}</td><td>${x.posted}/${x.total}</td><td>${x.posted ? n0(x.reach / x.posted) : "–"}</td><td>${pct(x.interactions, x.reach)}</td><td>${n0(x.clicks)}</td><td>${n0(x.orders)}</td><td>${money(x.revenue, p.currency)}</td></tr>`).join("")}
      </tbody></table></div>
    <h3>Every posted item</h3>
    ${posted.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Item</th><th>Date</th><th>Reach</th><th>Views</th><th>Engagement</th><th>Link clicks</th><th>Click rate</th><th>Orders</th><th>Revenue</th>${S.me.role === "owner" ? "<th>Cost</th><th>ROAS</th>" : ""}</tr></thead>
      <tbody>${posted.map((it) => {
        const m = it.metrics || {}; const inter = (m.likes || 0) + (m.comments || 0) + (m.shares || 0) + (m.saves || 0) + (m.replies || 0); const c = costOf(it, p);
        return `<tr data-act="open" data-id="${esc(it.id)}"><td>${kind(it)}, week ${it.week}</td><td>${dayDate(it.postedAt || it.date)}</td><td>${n0(m.reach)}</td><td>${n0(m.views)}</td><td>${pct(inter, m.reach)}</td><td>${n0(m.clicks)}</td><td>${pct(m.clicks || 0, m.reach)}</td><td>${n0(m.orders)}</td><td>${money(m.revenue ?? null, p.currency)}</td>${S.me.role === "owner" ? `<td>${money(c, p.currency)}</td><td>${ratio(m.revenue || 0, c)}</td>` : ""}</tr>`;
      }).join("")}</tbody></table></div>`
      : `<p class="muted">Results show up here once something is marked as posted and its Instagram numbers are added.</p>`}`;
}

function bars(weeks, key, color) {
  const W = 520, H = 150, pad = 24, bw = (W - pad) / 13;
  const max = Math.max(1, ...weeks.map((w) => w[key]));
  const nice = niceMax(max);
  const bar = weeks.map((w, i) => {
    const h = (w[key] / nice) * (H - 20);
    return `<rect x="${pad + i * bw + 3}" y="${H - h}" width="${bw - 6}" height="${Math.max(h, w[key] ? 2 : 0)}" fill="${color}" rx="1"><title>Week ${w.w}: ${n0(w[key])}</title></rect>
      <text x="${pad + i * bw + bw / 2}" y="${H + 16}" text-anchor="middle">${w.w}</text>`;
  }).join("");
  return `<svg viewBox="0 -6 ${W} ${H + 26}" role="img" aria-label="${key} per week">
    <line x1="${pad}" x2="${W}" y1="${H}" y2="${H}" stroke="var(--rule)"/>
    <line x1="${pad}" x2="${W}" y1="${H - (H - 20)}" y2="${H - (H - 20)}" stroke="var(--rule)" stroke-dasharray="2 4"/>
    <text x="0" y="${H - (H - 20) + 4}">${n0(nice)}</text><text x="0" y="${H + 4}">0</text>
    ${bar}</svg>`;
}
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return v; }

// ----- settings (owner) -----
function settingsView() {
  const p = S.page;
  return `<div class="settings">
    <div class="stack">
      <div class="codebox">
        <span>${esc(p.adminName || "The page admin")} signs in with this code</span>
        <div class="code">${esc(p.code)}</div>
        <div class="row"><button class="btn sm" data-act="copy-invite">Copy invite message</button><button class="btn sm" data-act="copy-code">Copy code</button></div>
      </div>
      <p class="small muted">The code opens only this page. ${esc(p.adminName || "The admin")} can see the schedule, approve or ask for changes, mark items as posted, and add results. They can't see other pages, your fees or your access codes.</p>
      <div><button class="btn sm red" data-act="new-code">Make a new code</button></div>
      <p class="small muted">A new code signs out anyone using the old one.</p>
    </div>
    <form class="stack" id="page-form">
      <h2>Page details</h2>
      ${pageForm(p)}
      <div class="row"><button class="btn solid">Save changes</button></div>
      <div class="danger"><button type="button" class="btn sm red" data-act="delete-page">Delete this page</button></div>
    </form>
  </div>`;
}

// ---------------- drawer (one post or story) ----------------
function openItem(id) { S.open = id; renderDrawer(); }
function closeDrawer() { S.open = null; drawerRoot.innerHTML = ""; document.body.style.overflow = ""; }
const getItem = () => S.items.find((x) => x.id === S.open);

function renderDrawer() {
  const it = getItem();
  if (!it) return closeDrawer();
  const owner = S.me.role === "owner";
  const scroll = drawerRoot.querySelector(".side")?.scrollTop || 0;
  const enter = drawerRoot.querySelector(".drawer")?.dataset.id === it.id ? "" : " enter";
  document.body.style.overflow = "hidden";
  drawerRoot.innerHTML = `<div class="scrim${enter}" data-act="close"></div>
    <aside class="drawer${enter}" data-id="${esc(it.id)}" role="dialog" aria-modal="true" aria-label="${kind(it)} for ${dayDate(it.date)}">
      <button class="btn sm close" data-act="close">Close</button>
      <div class="stage">${phone(it)}
        ${it.videoLink && safeUrl(it.videoLink) ? `<a class="btn sm" style="border-color:var(--paper);color:var(--paper)" href="${esc(safeUrl(it.videoLink))}" target="_blank" rel="noopener">Open video or extra files</a>` : ""}
      </div>
      <div class="side">
        <div class="sec">
          <div class="state-line"><h2 class="display" style="font-size:44px">${kind(it)}, week ${it.week}</h2></div>
          <div class="state-line"><span>${dayDate(it.date)}</span>${["approved", "changes", "rejected"].includes(it.state) ? `<span class="hand">${LABEL[it.state].toLowerCase()}</span>` : `<b>${LABEL[it.state]}</b>`}</div>
        </div>
        ${approvalSection(it)}
        ${owner && it.state !== "posted" && it.state !== "cancelled" ? editSection(it) : detailsSection(it)}
        ${postedSection(it)}
        ${threadSection(it)}
        ${owner ? `<div class="sec row">${it.state === "posted" ? `<button class="btn sm" data-act="unpost">Undo posted</button>` : ""}<button class="btn sm ghost" data-act="cancel">${it.state === "cancelled" ? "Restore this slot" : "Skip this slot"}</button></div>` : ""}
      </div>
    </aside>`;
  drawerRoot.querySelector(".side").scrollTop = enter ? 0 : scroll;
  if (enter) drawerRoot.querySelector(".close").focus({ preventScroll: true });
  bindDrawer(it);
}

function phone(it) {
  const p = S.page, src = mediaSrc(it);
  const handle = esc((p.handle || p.name || "").replace(/^@/, ""));
  if (it.type === "story") {
    return `<div class="phone story"><div class="media">${src ? `<img src="${src}" alt="Story image">` : `<span style="padding:20px">No image yet</span>`}
      <span class="bar"></span><span class="who-s"><span class="avatar" style="width:24px;height:24px"></span>${handle}</span>
      ${it.link || it.cta ? `<span class="sticker"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>${esc(it.cta || "Link")}</span>` : ""}
    </div></div>`;
  }
  return `<div class="phone"><div class="ig-head"><span class="avatar"></span>${handle}</div>
    <div class="media">${src ? `<img src="${src}" alt="Post image">` : `<span style="padding:20px">No image yet</span>`}</div>
    <div class="icons" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/></svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M21 12a9 9 0 0 1-13 8l-5 1 1-5A9 9 0 1 1 21 12z"/></svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M22 3 11 13M22 3l-7 19-4-9-9-4z"/></svg>
    </div>
    <div class="cap"><b>${handle}</b> ${esc(it.caption) || '<span style="color:#999">No caption yet</span>'}${it.hashtags ? `\n<span class="tags">${esc(it.hashtags)}</span>` : ""}</div>
  </div>`;
}

function approvalSection(it) {
  const owner = S.me.role === "owner";
  if (owner) {
    if (["draft", "changes", "rejected"].includes(it.state)) {
      return `<div class="sec"><div class="decide stack">
        <b>${it.state === "draft" ? `Ready? Send it to ${esc(adminName())} to approve.` : `Fixed it? Send it back to ${esc(adminName())}.`}</b>
        <textarea name="sendnote" rows="2" placeholder="Add a note (optional)"></textarea>
        <div><button class="btn solid" data-act="send">Send for approval</button></div></div></div>`;
    }
    if (it.state === "waiting") return `<div class="sec"><p class="muted" style="margin:0">Waiting for ${esc(adminName())} to approve. You can still edit it; they'll see the latest version.</p></div>`;
    return "";
  }
  if (it.state === "waiting" || ["approved", "changes", "rejected"].includes(it.state)) {
    return `<div class="sec"><div class="decide stack">
      <b>${it.state === "waiting" ? "Is this good to post on your page?" : "Change your answer"}</b>
      <textarea name="decnote" rows="3" placeholder="Note (needed if you ask for changes or reject)"></textarea>
      <div class="row">
        <button class="btn red solid" data-act="decide" data-d="approved">Approve</button>
        <button class="btn red" data-act="decide" data-d="changes">Ask for changes</button>
        <button class="btn ghost" data-act="decide" data-d="rejected">Reject</button>
      </div></div></div>`;
  }
  if (it.state === "draft") return `<div class="sec"><p class="muted" style="margin:0">This one is still being prepared. You'll be able to approve it once it's sent to you.</p></div>`;
  return "";
}

function editSection(it) {
  return `<form class="sec stack" id="edit">
    <h3>Content</h3>
    <div>
      <input type="file" id="file" accept="image/jpeg,image/png,image/webp" hidden>
      <div class="row">
        <label class="drop" for="file" style="flex:1">${it.media ? "Replace image" : `Upload ${it.type === "story" ? "story image (9:16)" : "post image (4:5)"}`}</label>
        ${it.media ? `<button type="button" class="btn sm ghost" data-act="rm-media">Remove</button>` : ""}
      </div>
    </div>
    <label class="f">Video or extra files link<span class="hint">For videos or carousels: a Google Drive or Dropbox link</span><input type="url" name="videoLink" value="${esc(it.videoLink)}" placeholder="https://"></label>
    <label class="f">Caption<textarea name="caption" rows="6" maxlength="2200">${esc(it.caption)}</textarea><span class="counter"><span id="cc">${it.caption.length}</span>/2200</span></label>
    <label class="f">Hashtags<input type="text" name="hashtags" value="${esc(it.hashtags)}" placeholder="#opium #00polo"></label>
    <div class="grid2">
      <label class="f">Link<input type="url" name="link" value="${esc(it.link)}" placeholder="https://opium00polo.com/..."></label>
      <label class="f">${it.type === "story" ? "Link sticker text" : "Call to action"}<input type="text" name="cta" value="${esc(it.cta)}" placeholder="${it.type === "story" ? "SHOP 00POLO" : "Link in bio"}"></label>
      <label class="f">Product<input type="text" name="product" value="${esc(it.product)}"></label>
      <label class="f">Date<input type="date" name="date" value="${esc(it.date)}"></label>
    </div>
    <label class="f">Notes for ${esc(adminName())}<span class="hint">Posting time, tags, music, anything they should know</span><textarea name="visual" rows="2">${esc(it.visual)}</textarea></label>
    <div class="row"><button class="btn solid">Save</button>${it.state === "approved" ? `<span class="small muted">Saving changes means it needs approval again.</span>` : ""}</div>
  </form>`;
}

function detailsSection(it) {
  const link = safeUrl(it.link);
  const rows = [
    ["Product", esc(it.product)],
    ["Link", link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a>` : esc(it.link)],
    [it.type === "story" ? "Sticker text" : "Call to action", esc(it.cta)],
    ["Notes", esc(it.visual).replace(/\n/g, "<br>")],
  ].filter(([, v]) => v);
  const img = mediaSrc(it);
  return `<div class="sec"><h3>Details</h3>
    ${rows.length ? `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>` : `<p class="muted">No extra details.</p>`}
    ${img ? `<p><a class="btn sm" href="${img}" download="${esc(it.id)}.jpg">Download image</a></p>` : ""}
    ${it.caption ? `<p><button class="btn sm" data-act="copy-caption">Copy caption</button></p>` : ""}</div>`;
}

const METRIC_FIELDS = {
  post: [["reach", "Reach"], ["views", "Views"], ["likes", "Likes"], ["comments", "Comments"], ["shares", "Shares"], ["saves", "Saves"], ["profileVisits", "Profile visits"], ["follows", "New follows"], ["clicks", "Link clicks"]],
  story: [["reach", "Reach"], ["views", "Views"], ["replies", "Replies"], ["shares", "Shares"], ["clicks", "Sticker taps"], ["profileVisits", "Profile visits"], ["follows", "New follows"]],
};

function postedSection(it) {
  const owner = S.me.role === "owner";
  if (it.state === "approved") {
    return `<form class="sec stack" id="post-form"><h3>${owner ? "Once it's live" : "Posted it?"}</h3>
      <div class="grid2"><label class="f">Link to the live ${kind(it).toLowerCase()}<input type="url" name="liveUrl" placeholder="https://instagram.com/..."></label>
      <label class="f">Posted on<input type="date" name="postedAt" value="${today()}"></label></div>
      <div><button class="btn solid">Mark as posted</button></div></form>`;
  }
  if (it.state !== "posted") return "";
  const m = it.metrics || {}, p = S.page;
  const inter = (m.likes || 0) + (m.comments || 0) + (m.shares || 0) + (m.saves || 0) + (m.replies || 0);
  const live = safeUrl(it.liveUrl);
  const cost = costOf(it, p);
  return `<form class="sec stack" id="metrics-form">
    <h3>Results</h3>
    <p class="small muted" style="margin:0">Posted ${dayDate(it.postedAt || it.date)}${live ? `, <a href="${esc(live)}" target="_blank" rel="noopener">view on Instagram</a>` : ""}. Copy these from Instagram Insights about 48 hours after posting.</p>
    <div class="metrics">${METRIC_FIELDS[it.type].map(([k, l]) => `<label class="f">${l}<input type="number" min="0" name="${k}" value="${m[k] ?? ""}" inputmode="numeric"></label>`).join("")}</div>
    ${owner ? `<div class="metrics">
      <label class="f">Orders<input type="number" min="0" name="orders" value="${m.orders ?? ""}"></label>
      <label class="f">Revenue (${esc(p.currency)})<input type="number" min="0" step="any" name="revenue" value="${m.revenue ?? ""}"></label>
      <label class="f">Cost (${esc(p.currency)})<input type="number" min="0" step="any" name="cost" value="${m.cost ?? ""}" placeholder="${(it.type === "post" ? p.feePost : p.feeStory) ?? ""}"></label>
    </div>` : ""}
    <label class="f">Screenshot of Insights<span class="hint">Optional link to proof</span><input type="url" name="insightsLink" value="${esc(it.insightsLink || "")}" placeholder="https://"></label>
    <div class="calc num"><span><b>${pct(inter, m.reach)}</b>engagement</span><span><b>${pct(m.clicks || 0, m.reach)}</b>click rate</span>${owner ? `<span><b>${money(cost, p.currency)}</b>cost</span><span><b>${ratio(m.revenue || 0, cost)}</b>ROAS</span>` : ""}</div>
    <div><button class="btn solid">Save results</button></div>
  </form>`;
}

function threadSection(it) {
  const EV = { sent: "sent it for approval", approved: "approved it", changes: "asked for changes", rejected: "rejected it", posted: "marked it as posted", unposted: "undid posted", edited: "edited it", cancelled: "skipped this slot", restored: "restored this slot" };
  const msgs = (it.thread || []).map((m) => {
    const when = new Date(m.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    if (m.kind === "comment") return `<div class="msg ${m.who}"><div class="by">${esc(m.name)}, ${when}</div>${esc(m.text).replace(/\n/g, "<br>")}</div>`;
    const text = m.kind === "posted" ? "" : m.text;
    return `<div class="msg event ${m.who}"><b>${esc(m.name)}</b> ${EV[m.kind] || m.kind}, ${when}${text ? `<div class="msg ${m.who}" style="margin-top:6px">${esc(text).replace(/\n/g, "<br>")}</div>` : ""}</div>`;
  }).join("");
  return `<form class="sec" id="comment-form"><h3>Conversation</h3>
    <div class="thread">${msgs || `<p class="small muted" style="margin:0">No messages yet.</p>`}</div>
    <div class="row" style="align-items:flex-end"><textarea name="text" rows="2" style="flex:1;min-height:0" placeholder="Write a message"></textarea><button class="btn">Send</button></div></form>`;
}

function bindDrawer(it) {
  const root = drawerRoot;
  const update = (item, msg, fresh) => {
    S.items = S.items.map((x) => (x.id === item.id ? item : x));
    if (fresh) S.fresh = item.id;
    render(); if (msg) toast(msg);
    setTimeout(() => (S.fresh = null), 800);
  };
  const busy = async (btn, fn) => {
    if (btn) btn.disabled = true;
    try { await fn(); } catch (e) { toast(e.message, true); if (btn && btn.isConnected) btn.disabled = false; }
  };
  const edit = root.querySelector("#edit");
  if (edit) {
    const cap = edit.querySelector("[name=caption]");
    cap.oninput = () => (root.querySelector("#cc").textContent = cap.value.length);
    edit.onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => update((await api("saveItem", { id: it.id, fields: Object.fromEntries(new FormData(edit)) })).item, "Saved")); };
    root.querySelector("#file").onchange = (e) => {
      const file = e.target.files[0]; if (!file) return;
      const label = root.querySelector(".drop"); label.textContent = "Uploading…";
      busy(null, async () => {
        const img = await compress(file, it.type);
        update((await api("upload", { id: it.id, ...img })).item, "Image uploaded");
      }).finally(() => { if (label.isConnected) label.textContent = "Replace image"; });
    };
  }
  const pf = root.querySelector("#post-form");
  if (pf) pf.onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => update((await api("posted", { id: it.id, ...Object.fromEntries(new FormData(pf)) })).item, "Marked as posted")); };
  const mf = root.querySelector("#metrics-form");
  if (mf) mf.onsubmit = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(mf)); const link = d.insightsLink; delete d.insightsLink;
    busy(e.submitter, async () => update((await api("metrics", { id: it.id, metrics: d, insightsLink: link })).item, "Results saved"));
  };
  const cf = root.querySelector("#comment-form");
  cf.onsubmit = (e) => { e.preventDefault(); const text = cf.text.value.trim(); if (!text) return; busy(e.submitter, async () => update((await api("comment", { id: it.id, text })).item)); };
}

// image → compressed JPEG data URL (keeps uploads small and fast)
async function compress(file, type) {
  const bmp = await createImageBitmap(file);
  const maxW = 1080, maxH = type === "story" ? 1920 : 1350;
  const scale = Math.min(1, maxW / bmp.width, maxH / bmp.height);
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  let q = 0.85, data = c.toDataURL("image/jpeg", q);
  while (data.length > 2_500_000 && q > 0.4) { q -= 0.1; data = c.toDataURL("image/jpeg", q); }
  return { data, w: c.width, h: c.height };
}

// ---------------- one click handler for everything ----------------
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  const it = getItem();
  const run = async (fn) => { el.disabled = true; try { await fn(); } catch (err) { toast(err.message, true); } finally { if (el.isConnected) el.disabled = false; } };
  const upd = (item, msg, fresh) => { S.items = S.items.map((x) => (x.id === item.id ? item : x)); if (fresh) S.fresh = item.id; render(); if (msg) toast(msg); setTimeout(() => (S.fresh = null), 800); };
  switch (act) {
    case "logout": await api("logout").catch(() => {}); S.me = { role: null }; S.page = null; S.pages = null; closeDrawer(); history.replaceState(null, "", location.pathname); render(); break;
    case "add-page": openAddPage(); break;
    case "tab": nav(`#/p/${S.page.id}/${el.dataset.tab}`); break;
    case "filter": S.filter = el.dataset.f; render(); break;
    case "open": e.preventDefault(); openItem(el.dataset.id); break;
    case "close": closeDrawer(); break;
    case "send": run(async () => upd((await api("send", { id: it.id, note: drawerRoot.querySelector("[name=sendnote]")?.value || "" })).item, `Sent to ${adminName()}`)); break;
    case "decide": run(async () => upd((await api("decide", { id: it.id, decision: el.dataset.d, note: drawerRoot.querySelector("[name=decnote]")?.value || "" })).item, el.dataset.d === "approved" ? "Approved" : el.dataset.d === "changes" ? "Changes requested" : "Rejected", true)); break;
    case "unpost": run(async () => upd((await api("unpost", { id: it.id })).item, "Moved back to approved")); break;
    case "cancel": run(async () => upd((await api("cancel", { id: it.id })).item, it.state === "cancelled" ? "Slot restored" : "Slot skipped")); break;
    case "rm-media": run(async () => upd((await api("removeMedia", { id: it.id })).item, "Image removed")); break;
    case "copy-caption": copy(`${it.caption}${it.hashtags ? "\n\n" + it.hashtags : ""}`, "Caption copied"); break;
    case "copy-code": copy(S.page.code, "Code copied"); break;
    case "copy-invite": {
      const url = `${location.origin}/#code=${S.page.code}`;
      copy(`Hi${S.page.adminName ? " " + S.page.adminName : ""}, this is where we'll share the OPM JPN posts and stories for ${S.page.name} for you to approve.\n\nOpen ${url}\nor go to ${location.origin} and sign in with code ${S.page.code}`, "Invite copied. Paste it into WhatsApp or email.");
      break;
    }
    case "new-code":
      if (!confirm(`Make a new code for ${S.page.name}? Anyone using the old code will be signed out.`)) return;
      run(async () => { S.page = (await api("newCode", { id: S.page.id })).page; render(); toast("New code ready"); });
      break;
    case "delete-page":
      if (prompt(`This deletes ${S.page.name} and all its posts, images and results. Type the page name to confirm.`) !== S.page.name) return;
      run(async () => { await api("deletePage", { id: S.page.id }); toast("Page deleted"); S.page = null; nav("#/"); });
      break;
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.id !== "page-form") return;
  e.preventDefault();
  const f = e.target;
  (async () => {
    try {
      const out = await api("updatePage", { id: S.page.id, fields: Object.fromEntries(new FormData(f)) });
      S.page = out.page;
      if (out.moved) S.items = (await api("page", { id: S.page.id }, "GET")).items;
      render(); toast(out.moved ? `Saved. ${out.moved} dates moved to the new start.` : "Saved");
    } catch (err) { toast(err.message, true); }
  })();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.open) closeDrawer(); });
function copy(text, msg) {
  navigator.clipboard?.writeText(text).then(() => toast(msg), () => { prompt("Copy this:", text); });
}

go();
