/* ============================================================
 * AnonChat — validasi token sesi (server-side)
 * Token = ts.rand.hmac(SECRET, ts.rand). Tidak bisa dipalsukan
 * dari console tanpa GATE_SECRET.
 * ============================================================ */
import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.GATE_SECRET || "";
const TOKEN_TTL_MS = 24 * 3600 * 1000;

export default function handler(req, res) {
  if (!SECRET) {
    return res.status(500).json({ ok: false, error: "server" });
  }
  const token = (req.method === "POST" ? (req.body && req.body.token) : req.query.token) || "";
  const parts = String(token).split(".");
  if (parts.length !== 3) return res.status(200).json({ ok: false });

  const [ts, rand, sig] = parts;
  if (!/^\d+$/.test(ts) || !/^[a-f0-9]{32}$/.test(rand) || !/^[a-f0-9]{64}$/.test(sig)) {
    return res.status(200).json({ ok: false });
  }
  if (Date.now() - parseInt(ts, 10) > TOKEN_TTL_MS) {
    return res.status(200).json({ ok: false, error: "expired" });
  }
  const expect = createHmac("sha256", SECRET).update(ts + "." + rand).digest("hex");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expect, "utf8");
  const valid = a.length === b.length && timingSafeEqual(a, b);
  return res.status(200).json({ ok: valid });
}
