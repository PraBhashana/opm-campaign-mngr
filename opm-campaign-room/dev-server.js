// Local preview: `OWNER_PASSWORD=yourpass node dev-server.js` then open http://localhost:3000
// Uses ./.data/db.json for storage unless Redis env vars are set.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import handler from "./api/app.js";

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(process.cwd(), "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/app")) return handler(req, res);
  let file = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split("?")[0])));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) file = path.join(ROOT, "index.html");
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`OPM campaign room on http://localhost:${PORT}`));
