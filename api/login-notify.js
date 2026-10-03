/* ============================================================
 * AnonChat — notif Telegram tiap ada login sukses
 * Dipanggil client sekali per sesi (setelah sandi + nama OK).
 * Token gate divalidasi dulu; token bot hanya di server.
 * ============================================================ */
import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.GATE_SECRET || "";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const OWNER_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID || "";
const TOKEN_TTL_MS = 24 * 3600 * 1000;

function validToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !SECRET) return false;
  const [ts, rand, sig] = parts;
  if (!/^\d+$/.test(ts) || !/^[a-f0-9]{32}$/.test(rand) || !/^[a-f0-9]{64}$/.test(sig)) return false;
  if (Date.now() - parseInt(ts, 10) > TOKEN_TTL_MS) return false;
  const expect = createHmac("sha256", SECRET).update(ts + "." + rand).digest("hex");
  const a = Buffer.from(sig, "utf8"), b = Buffer.from(expect, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

  if (!validToken(body && body.token)) return res.status(401).json({ ok: false });
  if (!BOT_TOKEN || !OWNER_CHAT_ID) return res.status(500).json({ ok: false, error: "config" });

  const name = String((body && body.name) || "Anonim").slice(0, 32);
  const waktu = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).replace(".", ":");

  const text = "🔐 Ada yang login AnonChat\n👤 Nama: " + name + "\n🕐 " + waktu + " WIB";

  try {
    const r = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: OWNER_CHAT_ID, text }),
    });
    const j = await r.json();
    return res.status(200).json({ ok: !!j.ok });
  } catch {
    return res.status(502).json({ ok: false, error: "telegram" });
  }
}
