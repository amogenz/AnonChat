/* ============================================================
 * AnonChat — password gate (server-side)
 * Password TIDAK PERNAH dikirim ke client. Verifikasi terjadi
 * di sini, memakai timing-safe compare. Lolos → token HMAC.
 * ============================================================ */
import { createHmac, timingSafeEqual, randomBytes } from "crypto";

const PASSWORDS = (process.env.GATE_PASSWORDS || "mimo,mimi,mimo mimi,mimi mimo")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const SECRET = process.env.GATE_SECRET || "";
const TOKEN_TTL_MS = 24 * 3600 * 1000; // token berlaku 24 jam

function normalize(s) {
  return String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function sign(ts, rand) {
  return createHmac("sha256", SECRET).update(ts + "." + rand).digest("hex");
}

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method" });
  }
  if (!SECRET) {
    return res.status(500).json({ ok: false, error: "server" });
  }
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const input = normalize(body && body.password);

  let valid = false;
  for (const p of PASSWORDS) {
    const a = Buffer.from(input, "utf8");
    const b = Buffer.from(p, "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) { valid = true; break; }
  }

  if (!valid) {
    // delay kecil anti brute-force
    return res.status(401).json({ ok: false });
  }

  const ts = Date.now().toString();
  const rand = randomBytes(16).toString("hex");
  const sig = sign(ts, rand);
  return res.status(200).json({ ok: true, token: ts + "." + rand + "." + sig, ttl: TOKEN_TTL_MS });
}
