// Tiny key-value layer.
// On Vercel: Upstash Redis over its REST API (no SDK needed).
// Locally (no Redis env vars): a JSON file in ./.data so you can try the app offline.
import fs from "node:fs";
import path from "node:path";

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export const usingRedis = Boolean(URL_ && TOKEN);
export const storageProblem =
  !usingRedis && process.env.VERCEL
    ? "No database is connected. In Vercel open Storage, add Upstash Redis to this project, then redeploy."
    : null;

async function redis(cmd) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.error) throw new Error("Database error: " + (out.error || res.status));
  return out.result;
}

// ---------- local file store ----------
const FILE = path.join(process.cwd(), ".data", "db.json");
let mem = null;
function load() {
  if (mem) return mem;
  try { mem = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { mem = {}; }
  return mem;
}
function persist() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(mem));
}
const local = {
  hget(k, f) { const h = load()[k]; return h && f in h ? h[f] : null; },
  hset(k, f, v) { const d = load(); (d[k] ||= {})[f] = v; persist(); },
  hdel(k, f) { const d = load(); if (d[k]) { delete d[k][f]; persist(); } },
  hgetall(k) { return { ...(load()[k] || {}) }; },
  get(k) { const v = load()[k]; return v === undefined ? null : v; },
  set(k, v) { load()[k] = v; persist(); },
  del(k) { delete load()[k]; persist(); },
  incr(k) { const d = load(); d[k] = (Number(d[k]) || 0) + 1; persist(); return d[k]; },
};

function pairsToObj(arr) {
  const o = {};
  for (let i = 0; arr && i < arr.length; i += 2) o[arr[i]] = arr[i + 1];
  return o;
}

export const kv = {
  async hget(k, f) { return usingRedis ? redis(["HGET", k, f]) : local.hget(k, f); },
  async hset(k, f, v) { return usingRedis ? redis(["HSET", k, f, v]) : local.hset(k, f, v); },
  async hdel(k, f) { return usingRedis ? redis(["HDEL", k, f]) : local.hdel(k, f); },
  async hgetall(k) { return usingRedis ? pairsToObj(await redis(["HGETALL", k])) : local.hgetall(k); },
  async get(k) { return usingRedis ? redis(["GET", k]) : local.get(k); },
  async set(k, v) { return usingRedis ? redis(["SET", k, v]) : local.set(k, v); },
  async del(k) { return usingRedis ? redis(["DEL", k]) : local.del(k); },
  async incrWithExpiry(k, seconds) {
    if (!usingRedis) return local.incr(k);
    const n = await redis(["INCR", k]);
    if (n === 1) await redis(["EXPIRE", k, seconds]);
    return n;
  },
};

// ---------- typed helpers ----------
const J = (s) => (s ? JSON.parse(s) : null);

export const db = {
  async listPages() {
    return Object.values(await kv.hgetall("opm:page")).map(J).sort((a, b) => a.created - b.created);
  },
  async getPage(id) { return J(await kv.hget("opm:page", id)); },
  async savePage(p) { await kv.hset("opm:page", p.id, JSON.stringify(p)); },
  async deletePage(p) {
    const items = await this.listItems(p.id);
    for (const it of items) if (it.media) await kv.del("opm:media:" + it.id);
    await kv.del("opm:items:" + p.id);
    await kv.hdel("opm:code", p.code);
    await kv.hdel("opm:page", p.id);
  },
  async pageIdForCode(code) { return kv.hget("opm:code", code); },
  async setCode(pageId, code, oldCode) {
    if (oldCode) await kv.hdel("opm:code", oldCode);
    await kv.hset("opm:code", code, pageId);
  },
  async listItems(pageId) {
    return Object.values(await kv.hgetall("opm:items:" + pageId)).map(J).sort((a, b) => a.n - b.n);
  },
  async getItem(pageId, id) { return J(await kv.hget("opm:items:" + pageId, id)); },
  async saveItem(it) { await kv.hset("opm:items:" + it.pageId, it.id, JSON.stringify(it)); },
  async getMedia(itemId) { return J(await kv.get("opm:media:" + itemId)); },
  async setMedia(itemId, m) { await kv.set("opm:media:" + itemId, JSON.stringify(m)); },
  async delMedia(itemId) { await kv.del("opm:media:" + itemId); },
};
