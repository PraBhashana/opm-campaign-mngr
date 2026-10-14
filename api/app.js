// The whole backend: one Vercel serverless function.
//   GET  /api/app?action=...      reads
//   POST /api/app  {action, ...}  writes
// Every request is checked: the owner can see everything; a page admin's
// session is tied to ONE page and every read/write is limited to it.
import { db, kv, storageProblem, usingRedis } from "../lib/kv.js";
import { readSession, writeSession, clearSession, codeTag, safeEqual, newCode, newId } from "../lib/session.js";

const OWNER_NAME = process.env.OWNER_NAME || "OPM JPN";
const WEEKS = 13;
const SLOTS = [
  { slot: "S1", type: "story", offset: 1 }, // Tuesday
  { slot: "P", type: "post", offset: 3 },   // Thursday
  { slot: "S2", type: "story", offset: 5 }, // Saturday
];
const METRICS = ["reach", "views", "likes", "comments", "shares", "saves", "replies", "clicks", "profileVisits", "follows", "orders", "revenue", "cost"];
const CONTENT = ["product", "visual", "caption", "hashtags", "link", "cta", "videoLink", "date"];

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

// ---------- helpers ----------
const str = (v, max = 4000) => (v == null ? "" : String(v).slice(0, max).trim());
const num = (v) => { if (v === "" || v == null) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
function addDays(iso, d) {
  const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}
const now = () => new Date().toISOString();

function scheduleDate(start, week, offset) { return addDays(start, (week - 1) * 7 + offset); }

function publicPage(p, role) {
  const out = { ...p };
  if (role !== "owner") delete out.code; // admins never see the access code list
  return out;
}

function summarize(items, page) {
  const s = { total: 0, draft: 0, waiting: 0, approved: 0, changes: 0, rejected: 0, posted: 0, cancelled: 0, overdue: 0,
    reach: 0, clicks: 0, orders: 0, revenue: 0, cost: 0, interactions: 0, strip: [] };
  const today = new Date().toISOString().slice(0, 10);
  for (const it of items) {
    s.total++; s[it.state]++;
    s.strip.push(it.state);
    if (it.date < today && !["posted", "cancelled"].includes(it.state)) s.overdue++;
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

async function readBody(req) {
  let pre;
  try { pre = req.body; } catch { return {}; } // Vercel pre-parses JSON; bad JSON throws
  if (pre !== undefined) req = { body: pre };
  if (req.body !== undefined && req.body !== null && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// Who is asking, and which page may they touch?
async function auth(req) {
  const s = readSession(req);
  if (!s) return null;
  if (s.r === "owner") return { role: "owner", name: OWNER_NAME };
  if (s.r === "admin") {
    const p = await db.getPage(s.p);
    if (!p || codeTag(p.code) !== s.c) return null; // page deleted or code changed
    return { role: "admin", pageId: p.id, name: p.adminName || "Page admin", page: p };
  }
  return null;
}
function needOwner(me) { if (!me || me.role !== "owner") fail(403, "Only the owner can do this."); }
function canSee(me, pageId) {
  if (!me) fail(401, "Please sign in.");
  if (me.role === "owner") return;
  if (me.pageId !== pageId) fail(403, "This page is not shared with you.");
}
async function loadItem(me, itemId) {
  const pageId = String(itemId || "").split("-")[0];
  canSee(me, pageId);
  const it = await db.getItem(pageId, itemId);
  if (!it) fail(404, "That post no longer exists.");
  return it;
}
function log(it, me, kind, text = "") {
  it.thread = it.thread || [];
  it.thread.push({ who: me.role, name: me.name, kind, text: str(text, 2000), at: now() });
  it.updated = now();
}

// ---------- actions ----------
const actions = {
  // ----- sign in -----
  async login(req, res, body) {
    if (storageProblem) fail(503, storageProblem);
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "local").split(",")[0].trim();
    const failKey = "opm:fail:" + ip;
    const tries = Number(await kv.get(failKey)) || 0;
    if (tries >= 15) fail(429, "Too many wrong codes. Try again in 15 minutes.");
    const code = str(body.code, 200);
    if (!process.env.OWNER_PASSWORD) fail(503, "OWNER_PASSWORD is not set. Add it in Vercel → Settings → Environment Variables, then redeploy.");
    if (code && safeEqual(code, process.env.OWNER_PASSWORD)) {
      writeSession(req, res, { r: "owner" });
      return { role: "owner" };
    }
    const pageId = code ? await db.pageIdForCode(code.toUpperCase().replace(/\s+/g, "")) : null;
    if (pageId) {
      const p = await db.getPage(pageId);
      if (p) {
        writeSession(req, res, { r: "admin", p: p.id, c: codeTag(p.code) });
        return { role: "admin", pageId: p.id };
      }
    }
    await kv.incrWithExpiry(failKey, 900);
    await new Promise((r) => setTimeout(r, 500));
    fail(401, "That code didn't match. Check it and try again.");
  },
  async logout(req, res) { clearSession(req, res); return { ok: true }; },

  async me(req, res, body, me) {
    if (!me) return { role: null, storageProblem, local: !usingRedis };
    return { role: me.role, name: me.name, pageId: me.pageId || null, local: !usingRedis };
  },

  // ----- pages -----
  async overview(req, res, body, me) {
    needOwner(me);
    const pages = await db.listPages();
    const out = [];
    for (const p of pages) out.push({ ...p, summary: summarize(await db.listItems(p.id), p) });
    return { pages: out };
  },

  async page(req, res, body, me) {
    const id = str(body.id, 40);
    canSee(me, id);
    const p = await db.getPage(id);
    if (!p) fail(404, "That page was deleted.");
    return { page: publicPage(p, me.role), items: await db.listItems(id) };
  },

  async createPage(req, res, body, me) {
    needOwner(me);
    const name = str(body.name, 80);
    if (!name) fail(400, "Give the page a name.");
    const start = isDate(body.start) ? body.start : null;
    if (!start) fail(400, "Pick the campaign start date.");
    const p = {
      id: newId(8), name, handle: str(body.handle, 60), adminName: str(body.adminName, 80),
      adminContact: str(body.adminContact, 120), start, currency: str(body.currency, 8) || "USD",
      feePost: num(body.feePost), feeStory: num(body.feeStory), discountCode: str(body.discountCode, 40),
      link: str(body.link, 500), followersStart: num(body.followersStart), followersNow: num(body.followersNow),
      code: newCode(), created: Date.now(),
    };
    await db.savePage(p);
    await db.setCode(p.id, p.code);
    let n = 0;
    for (let w = 1; w <= WEEKS; w++) {
      for (const s of SLOTS) {
        n++;
        await db.saveItem({
          id: `${p.id}-${n}`, pageId: p.id, n, week: w, slot: s.slot, type: s.type,
          date: scheduleDate(start, w, s.offset), dateMoved: false,
          product: "", visual: "", caption: "", hashtags: "", link: p.link || "", cta: "", videoLink: "",
          media: null, state: "draft", thread: [], liveUrl: "", postedAt: "", metrics: {}, updated: now(),
        });
      }
    }
    return { page: p };
  },

  async updatePage(req, res, body, me) {
    needOwner(me);
    const p = await db.getPage(str(body.id, 40));
    if (!p) fail(404, "That page was deleted.");
    const f = body.fields || {};
    for (const k of ["name", "handle", "adminName", "adminContact", "currency", "discountCode", "link"]) if (k in f) p[k] = str(f[k], k === "link" ? 500 : 120);
    for (const k of ["feePost", "feeStory", "followersStart", "followersNow"]) if (k in f) p[k] = num(f[k]);
    if (!p.name) fail(400, "The page needs a name.");
    let moved = 0;
    if ("start" in f && isDate(f.start) && f.start !== p.start) {
      p.start = f.start;
      for (const it of await db.listItems(p.id)) {
        if (it.dateMoved || it.state === "posted") continue;
        const s = SLOTS.find((x) => x.slot === it.slot);
        it.date = scheduleDate(p.start, it.week, s.offset);
        await db.saveItem(it); moved++;
      }
    }
    await db.savePage(p);
    return { page: p, moved };
  },

  async newCode(req, res, body, me) {
    needOwner(me);
    const p = await db.getPage(str(body.id, 40));
    if (!p) fail(404, "That page was deleted.");
    const old = p.code;
    p.code = newCode();
    await db.setCode(p.id, p.code, old);
    await db.savePage(p);
    return { page: p };
  },

  async deletePage(req, res, body, me) {
    needOwner(me);
    const p = await db.getPage(str(body.id, 40));
    if (!p) return { ok: true };
    await db.deletePage(p);
    return { ok: true };
  },

  // ----- posts & stories -----
  async saveItem(req, res, body, me) {
    needOwner(me);
    const it = await loadItem(me, body.id);
    if (it.state === "posted") fail(409, "This is already posted. Undo 'posted' first if you need to change it.");
    const f = body.fields || {};
    let changed = false;
    for (const k of CONTENT) {
      if (!(k in f)) continue;
      let v = str(f[k], k === "caption" ? 2200 : 500);
      if (k === "date") { if (!isDate(v)) continue; if (v !== it.date) it.dateMoved = true; }
      if (v !== it[k]) { it[k] = v; if (k !== "date") changed = true; }
    }
    if (changed && it.state === "approved") { it.state = "draft"; log(it, me, "edited", "Edited after approval, so it needs approval again."); }
    it.updated = now();
    await db.saveItem(it);
    return { item: it };
  },

  async upload(req, res, body, me) {
    needOwner(me);
    const it = await loadItem(me, body.id);
    const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ""));
    if (!m) fail(400, "Upload a JPG, PNG or WebP image.");
    if (m[3].length > 4_000_000) fail(413, "That image is too large. Try a smaller one.");
    await db.setMedia(it.id, { mime: m[1], data: m[3] });
    it.media = { w: num(body.w), h: num(body.h), v: Date.now() };
    if (it.state === "approved") { it.state = "draft"; log(it, me, "edited", "Image changed after approval, so it needs approval again."); }
    it.updated = now();
    await db.saveItem(it);
    return { item: it };
  },

  async removeMedia(req, res, body, me) {
    needOwner(me);
    const it = await loadItem(me, body.id);
    await db.delMedia(it.id);
    it.media = null; it.updated = now();
    if (it.state === "approved") { it.state = "draft"; log(it, me, "edited", "Image removed after approval, so it needs approval again."); }
    await db.saveItem(it);
    return { item: it };
  },

  async send(req, res, body, me) {
    needOwner(me);
    const it = await loadItem(me, body.id);
    if (!["draft", "changes", "rejected"].includes(it.state)) fail(409, "This one isn't waiting to be sent.");
    if (!it.media && !it.caption && !it.videoLink) fail(400, "Add an image, video link or caption before sending it for approval.");
    it.state = "waiting";
    log(it, me, "sent", body.note);
    await db.saveItem(it);
    return { item: it };
  },

  async decide(req, res, body, me) {
    if (!me || me.role !== "admin") fail(403, "Only the page admin approves.");
    const it = await loadItem(me, body.id);
    const d = body.decision;
    if (!["approved", "changes", "rejected"].includes(d)) fail(400, "Pick approve, ask for changes, or reject.");
    if (["draft", "posted", "cancelled"].includes(it.state)) fail(409, "This one isn't waiting for your approval.");
    if (d !== "approved" && !str(body.note)) fail(400, "Add a note so they know what to change.");
    it.state = d;
    log(it, me, d, body.note);
    await db.saveItem(it);
    return { item: it };
  },

  async comment(req, res, body, me) {
    const it = await loadItem(me, body.id);
    if (!str(body.text)) fail(400, "Write a message first.");
    log(it, me, "comment", body.text);
    await db.saveItem(it);
    return { item: it };
  },

  async posted(req, res, body, me) {
    const it = await loadItem(me, body.id);
    if (me.role === "admin" && it.state !== "approved") fail(409, "Only approved posts can be marked as posted.");
    if (it.state === "cancelled") fail(409, "Restore it first.");
    it.state = "posted";
    it.liveUrl = str(body.liveUrl, 500);
    it.postedAt = isDate(body.postedAt) ? body.postedAt : new Date().toISOString().slice(0, 10);
    log(it, me, "posted", it.liveUrl);
    await db.saveItem(it);
    return { item: it };
  },

  async unpost(req, res, body, me) {
    needOwner(me);
    const it = await loadItem(me, body.id);
    if (it.state !== "posted") fail(409, "This isn't marked as posted.");
    it.state = "approved"; it.postedAt = "";
    log(it, me, "unposted");
    await db.saveItem(it);
    return { item: it };
  },

  async cancel(req, res, body, me) {
    needOwner(me);
    const it = await loadItem(me, body.id);
    it.state = it.state === "cancelled" ? "draft" : "cancelled";
    log(it, me, it.state === "cancelled" ? "cancelled" : "restored");
    await db.saveItem(it);
    return { item: it };
  },

  async metrics(req, res, body, me) {
    const it = await loadItem(me, body.id);
    if (it.state !== "posted") fail(409, "Mark it as posted before adding results.");
    const m = {};
    for (const k of METRICS) { const v = num((body.metrics || {})[k]); if (v != null) m[k] = v; }
    if (me.role !== "owner" && it.metrics && it.metrics.cost != null) m.cost = it.metrics.cost; // admins can't change cost
    else if (me.role !== "owner") delete m.cost;
    it.metrics = m;
    it.insightsLink = str(body.insightsLink, 500);
    it.updated = now();
    await db.saveItem(it);
    return { item: it };
  },
};

const READS = new Set(["me", "overview", "page"]);

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://x");
    // Media is streamed as an image, not JSON
    if (req.method === "GET" && url.searchParams.get("action") === "media") {
      const me = await auth(req);
      const id = url.searchParams.get("id") || "";
      canSee(me, id.split("-")[0]);
      const m = await db.getMedia(id);
      if (!m) { res.statusCode = 404; return res.end(); }
      res.statusCode = 200;
      res.setHeader("Content-Type", m.mime);
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      return res.end(Buffer.from(m.data, "base64"));
    }

    let action, body;
    if (req.method === "GET") {
      action = url.searchParams.get("action");
      body = Object.fromEntries(url.searchParams);
      if (!READS.has(action)) fail(405, "Use POST for this.");
    } else if (req.method === "POST") {
      body = await readBody(req);
      action = body.action;
      if (READS.has(action)) fail(405, "Use GET for this.");
      // basic CSRF guard: only accept JSON posts from our own pages
      if (!String(req.headers["content-type"] || "").includes("application/json")) fail(415, "Send JSON.");
    } else fail(405, "Method not allowed.");

    const fn = actions[action];
    if (!fn) fail(404, "Unknown action.");
    const me = action === "login" ? null : await auth(req);
    if (!me && !["login", "logout", "me"].includes(action)) fail(401, "Please sign in.");
    const out = await fn(req, res, body, me);
    send(res, 200, out);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    send(res, status, { error: e.status ? e.message : "Something went wrong on the server. Try again." });
  }
}
