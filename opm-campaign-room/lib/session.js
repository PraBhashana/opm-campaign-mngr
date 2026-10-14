// Signed session cookie. No extra secret to manage: the signing key is derived
// from OWNER_PASSWORD (set SESSION_SECRET if you prefer a separate one).
// Changing OWNER_PASSWORD logs everyone out.
import crypto from "node:crypto";

const COOKIE = "opm_s";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function key() {
  const base = process.env.SESSION_SECRET || process.env.OWNER_PASSWORD || "";
  return crypto.createHash("sha256").update("opm-session:" + base).digest();
}
const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (data) => crypto.createHmac("sha256", key()).update(data).digest("base64url");

export function codeTag(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex").slice(0, 10);
}

export function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

export function readSession(req) {
  const raw = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return null;
  const [data, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!data || !sig) return null;
  const good = sign(data);
  if (good.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig))) return null;
  try {
    const s = JSON.parse(Buffer.from(data, "base64url").toString());
    if (!s.exp || s.exp < Date.now()) return null;
    return s;
  } catch { return null; }
}

function cookieAttrs(req, maxAge) {
  const secure = (req.headers["x-forwarded-proto"] || "").includes("https") || process.env.VERCEL ? "; Secure" : "";
  return `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function writeSession(req, res, payload) {
  const data = b64(JSON.stringify({ ...payload, exp: Date.now() + MAX_AGE * 1000 }));
  res.setHeader("Set-Cookie", `${COOKIE}=${data}.${sign(data)}${cookieAttrs(req, MAX_AGE)}`);
}

export function clearSession(req, res) {
  res.setHeader("Set-Cookie", `${COOKIE}=${cookieAttrs(req, 0)}`);
}

export function newCode() {
  // 10 characters, no look-alikes (0/O, 1/I/L)
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

export function newId(len = 8) {
  return crypto.randomBytes(len).toString("base64url").replace(/[-_]/g, "x").slice(0, len);
}
