/* ============================================================
 * AnonChat v5 — gerbang sandi + centang dibaca + typing fix + bom 20 mnt
 * Alur: sandi (server) → nama → lobby. Chat & sesi hancur tiap 20 mnt.
 * ============================================================ */

const LOBBY_ID = "00000000-0000-0000-0000-000000000001";
const LS_ID = "ac_id";
const LS_NAME = "ac_name";
const LS_TOKEN = "ac_gate";
const ONLINE_MS = 90000;
const HEARTBEAT_MS = 20000;
const MSG_TTL_MS = 20 * 60 * 1000;      // chat hancur otomatis setelah 20 menit
const SELF_DESTRUCT_MS = 20 * 60 * 1000; // sesi hancur total tiap 20 menit
const SELF_DESTRUCT_WARN_MS = 60 * 1000; // peringatan 60 detik sebelumnya

let sb = null;
let me = null;
let msgCh = null, presenceCh = null;
let renderedIds = new Set();
let msgCache = new Map();
let typingUsers = new Map();
let typingSentAt = 0;
let typingStopTimer = null;
let onlineTimer = null;
let lastOnlineText = "menghubungkan…";
let markedDelivered = new Set();
let markedRead = new Set();
let markTimer = null;
const markQueue = { delivered: new Set(), read: new Set() };

/* ---------- util ---------- */
const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }).replace(".", ":");
}
function fmtDay(iso) {
  const d = new Date(iso), today = new Date(), y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hari ini";
  if (d.toDateString() === y.toDateString()) return "Kemarin";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}
function isConfigured() {
  return typeof SUPABASE_URL === "string" && !SUPABASE_URL.includes("ISI-DENGAN")
    && typeof SUPABASE_ANON_KEY === "string" && !SUPABASE_ANON_KEY.includes("ISI-DENGAN");
}

const AVATAR_COLORS = ["#00A884", "#009DE2", "#9B51E0", "#E91E63", "#F2994A", "#2D9CDB", "#D3396C", "#4CAF50", "#FF8A65", "#7986CB"];
function avatarColor(key) {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
const SENDER_COLORS = ["#00A884", "#009DE2", "#9B51E0", "#D3396C", "#F2994A", "#E91E63", "#2D9CDB", "#4CAF50"];
function senderColor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SENDER_COLORS[h % SENDER_COLORS.length];
}

/* ---------- centang ala WA ---------- */
const TICK_PATH = '<path d="M1.5 7.2l3.8 3.8L13.8 2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>';
function tickHTML(kind) {
  // kind: sent (1 abu) | delivered (2 abu) | read (2 biru)
  if (kind === "read") return '<span class="tick double blue"><svg viewBox="0 0 16 13">' + TICK_PATH + '</svg><svg viewBox="0 0 16 13">' + TICK_PATH + '</svg></span>';
  if (kind === "delivered") return '<span class="tick double gray"><svg viewBox="0 0 16 13">' + TICK_PATH + '</svg><svg viewBox="0 0 16 13">' + TICK_PATH + '</svg></span>';
  return '<span class="tick gray"><svg viewBox="0 0 16 13">' + TICK_PATH + '</svg></span>';
}
function tickKind(m) {
  if ((m.read_by || []).length > 0) return "read";
  if ((m.delivered_to || []).length > 0) return "delivered";
  return "sent";
}

/* ---------- identitas ---------- */
function loadIdentity() {
  let id = localStorage.getItem(LS_ID);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(LS_ID, id); }
  return {
    id,
    code: id.replace(/-/g, "").slice(0, 6).toUpperCase(),
    name: localStorage.getItem(LS_NAME) || "",
  };
}

/* ---------- gerbang sandi (verifikasi server) ---------- */
async function checkGate() {
  const token = sessionStorage.getItem(LS_TOKEN);
  if (!token) return false;
  try {
    const r = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const j = await r.json();
    return !!j.ok;
  } catch { return false; }
}

function showGate() {
  $("gate").classList.remove("hidden");
  $("modal-nick").classList.add("hidden");
  const input = $("gate-input");
  input.focus();
  const submit = async () => {
    const btn = $("gate-ok");
    btn.disabled = true;
    btn.textContent = "Memeriksa…";
    $("gate-error").classList.add("hidden");
    try {
      const r = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: input.value }),
      });
      const j = await r.json();
      if (j.ok && j.token) {
        sessionStorage.setItem(LS_TOKEN, j.token);
        $("gate").classList.add("hidden");
        afterGate();
      } else {
        $("gate-error").classList.remove("hidden");
        input.value = "";
        input.focus();
      }
    } catch {
      $("gate-error").textContent = "Gangguan jaringan. Coba lagi.";
      $("gate-error").classList.remove("hidden");
    }
    btn.disabled = false;
    btn.textContent = "Buka";
  };
  $("gate-ok").onclick = submit;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
}

/* ---------- boot ---------- */
window.addEventListener("DOMContentLoaded", async () => {
  if (!isConfigured()) {
    $("config-warning").classList.remove("hidden");
    $("modal-nick").classList.add("hidden");
    $("gate").classList.add("hidden");
    return;
  }
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  me = loadIdentity();

  if (await checkGate()) {
    $("gate").classList.add("hidden");
    afterGate();
  } else {
    sessionStorage.removeItem(LS_TOKEN);
    showGate();
  }
});

function afterGate() {
  if (!me.name) {
    $("modal-nick").classList.remove("hidden"); // FIX: modal sempat di-hidden oleh showGate()
    $("nick-input").focus();
    $("nick-ok").onclick = () => {
      const v = $("nick-input").value.trim().slice(0, 24);
      if (!v) { $("nick-input").focus(); return; }
      me.name = v;
      localStorage.setItem(LS_NAME, v);
      $("modal-nick").classList.add("hidden");
      boot();
    };
    $("nick-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("nick-ok").click(); });
  } else {
    $("modal-nick").classList.add("hidden");
    boot();
  }
}

async function boot() {
  // Setiap langkah dibungkus try/catch: satu gagal, yang lain tetap jalan.
  // Status "menghubungkan…" tidak boleh nyangkut selamanya.
  try {
    await sb.from("users").upsert(
      { id: me.id, code: me.code, name: me.name, last_seen: new Date().toISOString(), active_room_id: LOBBY_ID },
      { onConflict: "id" }
    );
  } catch (e) { console.warn("upsert user gagal:", e); }

  try { await purgeExpired(); } catch (e) { console.warn("purge gagal:", e); }

  notifyLogin(); // kabari Bos via Telegram (sekali per sesi)
  wireUI();
  setupPresence();
  setInterval(heartbeat, HEARTBEAT_MS);

  // daftar online dulu (REST, cepat) biar status langsung hidup
  try { await refreshOnlineList(); } catch (e) { console.warn("online list gagal:", e); }

  try { await loadMessages(); } catch (e) { console.warn("load messages gagal:", e); }
  subscribeMessages();

  onlineTimer = setInterval(refreshOnlineList, 15000);

  // pengaman terakhir: kalau 10 detik masih "menghubungkan…", paksa tampil
  setTimeout(() => {
    const el = $("chat-status");
    if (el && el.textContent === "menghubungkan…") setOnlineText(1);
  }, 10000);

  startSelfDestruct();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") markVisibleAsRead();
    else broadcastTypingStop();
  });
  window.addEventListener("pagehide", () => broadcastTypingStop());
}

/* ---------- auto-hapus chat lebih dari 24 jam ---------- */
async function purgeExpired() {
  const cutoff = new Date(Date.now() - MSG_TTL_MS).toISOString();
  await sb.from("messages").delete().lt("created_at", cutoff);
}

async function heartbeat() {
  if (!sb) return;
  await sb.from("users").update({
    last_seen: new Date().toISOString(),
    active_room_id: LOBBY_ID,
  }).eq("id", me.id);
}

/* ---------- presence ---------- */
function setupPresence() {
  presenceCh = sb.channel("lobby-presence", { config: { presence: { key: me.id } } });
  presenceCh.on("presence", { event: "sync" }, () => {
    updateOnlineCount();
  }).subscribe(async (status) => {
    if (status === "SUBSCRIBED") await presenceCh.track({ id: me.id, name: me.name });
  });
}

function updateOnlineCount() {
  if (!presenceCh) return;
  const n = Object.keys(presenceCh.presenceState()).length;
  const pill = $("online-count");
  pill.textContent = n;
  pill.classList.toggle("hidden", n <= 1);
  setOnlineText(n);
}

function setOnlineText(n) {
  if (typingUsers.size) return; // jangan timpa indikator mengetik
  lastOnlineText = n > 1 ? n + " online" : "hanya kamu di sini";
  const el = $("chat-status");
  el.classList.remove("typing");
  el.classList.toggle("online", n > 1);
  el.textContent = lastOnlineText;
}

async function refreshOnlineList() {
  const since = new Date(Date.now() - ONLINE_MS).toISOString();
  const { data } = await sb.from("users")
    .select("id,name,last_seen")
    .gt("last_seen", since)
    .order("name", { ascending: true })
    .limit(200);
  const list = $("online-list");
  list.innerHTML = "";
  (data || []).forEach((u) => {
    const row = document.createElement("div");
    row.className = "online-row" + (u.id === me.id ? " me" : "");
    row.innerHTML =
      '<span class="avatar sm" style="background:' + avatarColor(u.id) + '">' +
        escapeHtml((u.name || "?").charAt(0).toUpperCase()) + "</span>" +
      '<span class="online-name">' + escapeHtml(u.name || "Anonim") + (u.id === me.id ? " (kamu)" : "") + "</span>" +
      '<span class="online-dot"></span>';
    list.appendChild(row);
  });
  if (!list.children.length) {
    list.innerHTML = '<div class="empty-note">Belum ada yang online.</div>';
  }
  setOnlineText((data || []).length);
}

/* ---------- pesan ---------- */
function scrollBottom() {
  const box = $("messages");
  box.scrollTop = box.scrollHeight;
}

function appendMessage(m, animate) {
  if (renderedIds.has(m.id)) return;
  renderedIds.add(m.id);
  msgCache.set(m.id, m);

  const box = $("messages");
  const typingEl = $("typing-bubble");
  const msgs = box.querySelectorAll(".msg[data-mid]");
  const prev = msgs.length ? msgs[msgs.length - 1] : null;
  const prevM = prev ? msgCache.get(prev.dataset.mid) : null;
  const dayChanged = !prevM || new Date(prevM.created_at).toDateString() !== new Date(m.created_at).toDateString();
  if (dayChanged) {
    const d = document.createElement("div");
    d.className = "day-pill";
    d.textContent = fmtDay(m.created_at);
    if (typingEl) box.insertBefore(d, typingEl); else box.appendChild(d);
  }

  const own = m.sender_id === me.id;
  const grouped = prevM && prevM.sender_id === m.sender_id &&
    (new Date(m.created_at) - new Date(prevM.created_at)) < 5 * 60000 && !dayChanged;

  const el = document.createElement("div");
  el.className = "msg " + (own ? "out" : "in") + (grouped ? " grouped" : "") + (animate ? " pop" : "");
  el.dataset.mid = m.id;
  const meta = own
    ? '<span class="msg-meta">' + fmtTime(m.created_at) + tickHTML(tickKind(m)) + "</span>"
    : '<span class="msg-meta">' + fmtTime(m.created_at) + "</span>";
  el.innerHTML =
    '<div class="bubble">' +
      (!own ? '<div class="sender" style="color:' + senderColor(m.sender_id) + '">' + escapeHtml(m.sender_name) + "</div>" : "") +
      '<span class="body">' + escapeHtml(m.body) + "</span>" + meta +
    "</div>";
  if (typingEl) box.insertBefore(el, typingEl); else box.appendChild(el);

  if (!own) {
    if (!markedDelivered.has(m.id)) queueMark("delivered", m.id);
    if (document.visibilityState === "visible" && !markedRead.has(m.id)) queueMark("read", m.id);
  }
}

function updateTicks(m) {
  if (!m || m.sender_id !== me.id) return;
  const el = document.querySelector('[data-mid="' + m.id + '"]');
  if (!el) return;
  const meta = el.querySelector(".msg-meta");
  if (meta) meta.innerHTML = fmtTime(m.created_at) + tickHTML(tickKind(m));
  const cached = msgCache.get(m.id) || {};
  msgCache.set(m.id, { ...cached, delivered_to: m.delivered_to, read_by: m.read_by });
}

/* ---------- antrean penanda dibaca (debounce, hemat tulis) ---------- */
function queueMark(kind, mid) {
  markQueue[kind].add(mid);
  clearTimeout(markTimer);
  markTimer = setTimeout(flushMarks, 1200);
}

async function flushMarks() {
  if (!sb || !me) return;
  const jobs = [];
  markQueue.delivered.forEach((mid) => { markedDelivered.add(mid); jobs.push(["delivered", mid]); });
  markQueue.read.forEach((mid) => { markedRead.add(mid); jobs.push(["read", mid]); });
  markQueue.delivered.clear(); markQueue.read.clear();
  for (const [kind, mid] of jobs) {
    try { await sb.rpc("mark_msg", { p_mid: mid, p_uid: me.id, p_kind: kind }); } catch {}
  }
}

function markVisibleAsRead() {
  msgCache.forEach((m, mid) => {
    if (m.sender_id !== me.id && !markedRead.has(mid)) queueMark("read", mid);
  });
}

async function loadMessages() {
  const cutoff = new Date(Date.now() - MSG_TTL_MS).toISOString();
  let { data, error } = await sb.from("messages")
    .select("id,sender_id,sender_name,body,created_at,delivered_to,read_by")
    .eq("room_id", LOBBY_ID)
    .gt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error && /column/i.test(error.message || "")) {
    // fallback: migrasi v4 belum dijalankan — jalan tanpa centang ganda
    const r2 = await sb.from("messages")
      .select("id,sender_id,sender_name,body,created_at")
      .eq("room_id", LOBBY_ID)
      .gt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(100);
    data = r2.data;
  }
  (data || []).forEach((m) => {
    appendMessage(m, false);
    if (m.sender_id !== me.id) {
      markedDelivered.add(m.id);
      if (document.visibilityState === "visible") markedRead.add(m.id);
    }
  });
  (data || []).forEach((m) => {
    if (m.sender_id !== me.id) {
      queueMark("delivered", m.id);
      if (document.visibilityState === "visible") queueMark("read", m.id);
    }
  });
  scrollBottom();
}

function subscribeMessages() {
  msgCh = sb.channel("lobby-messages", { config: { broadcast: { self: false } } })
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: "room_id=eq." + LOBBY_ID },
      (p) => {
        const m = p.new;
        if (!m || renderedIds.has(m.id)) return;
        if (m.sender_id !== me.id) {
          appendMessage(m, true);
          scrollBottom();
        }
      })
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages", filter: "room_id=eq." + LOBBY_ID },
      (p) => {
        const m = p.new;
        if (m) updateTicks(m);
      })
    .on("broadcast", { event: "typing" }, (p) => handleTyping(p.payload))
    .on("broadcast", { event: "typing_stop" }, (p) => handleTypingStop(p.payload))
    .subscribe();
}

/* ---------- indikator mengetik (diperbaiki) ---------- */
function clearTyping() {
  typingUsers.forEach((t) => clearTimeout(t.timeout));
  typingUsers.clear();
  clearTimeout(typingStopTimer);
  hideTypingBubble();
}

function broadcastTyping() {
  if (!msgCh) return;
  const now = Date.now();
  if (now - typingSentAt > 2500) {
    typingSentAt = now;
    msgCh.send({ type: "broadcast", event: "typing", payload: { user_id: me.id, name: me.name } });
  }
  clearTimeout(typingStopTimer);
  typingStopTimer = setTimeout(broadcastTypingStop, 3000);
}

function broadcastTypingStop() {
  clearTimeout(typingStopTimer);
  if (msgCh && me) msgCh.send({ type: "broadcast", event: "typing_stop", payload: { user_id: me.id } });
}

function handleTyping(p) {
  if (!p || p.user_id === me.id) return;
  clearTimeout(typingUsers.get(p.user_id)?.timeout);
  const timeout = setTimeout(() => { typingUsers.delete(p.user_id); renderTyping(); }, 4000);
  typingUsers.set(p.user_id, { name: p.name || "Seseorang", timeout });
  renderTyping();
}

function handleTypingStop(p) {
  if (!p) return;
  clearTimeout(typingUsers.get(p.user_id)?.timeout);
  typingUsers.delete(p.user_id);
  renderTyping();
}

function renderTyping() {
  const el = $("chat-status");
  if (typingUsers.size) {
    const names = [...typingUsers.values()].map((t) => t.name);
    el.textContent = names.length === 1
      ? names[0] + " mengetik…"
      : names.length === 2
        ? names[0] + " dan " + names[1] + " mengetik…"
        : names[0] + " dan " + (names.length - 1) + " lainnya mengetik…";
    el.classList.add("online", "typing");
    showTypingBubble();
  } else {
    el.classList.remove("typing");
    el.textContent = lastOnlineText; // kembalikan teks online tanpa query ulang
    hideTypingBubble();
  }
}

function showTypingBubble() {
  let b = $("typing-bubble");
  if (!b) {
    b = document.createElement("div");
    b.id = "typing-bubble";
    b.className = "msg in";
    b.innerHTML = '<div class="bubble typing-dots"><span></span><span></span><span></span></div>';
    $("messages").appendChild(b);
  }
  b.style.display = "flex";
  scrollBottom();
}

function hideTypingBubble() {
  const b = $("typing-bubble");
  if (b) b.style.display = "none";
}

/* ---------- bom waktu 20 menit: hancurkan semua, refresh, sandi lagi ---------- */
let destructTimer = null;
let destructWarnTimer = null;

function startSelfDestruct() {
  clearTimeout(destructTimer);
  clearTimeout(destructWarnTimer);
  destructWarnTimer = setTimeout(showDestructWarning, SELF_DESTRUCT_MS - SELF_DESTRUCT_WARN_MS);
  destructTimer = setTimeout(selfDestruct, SELF_DESTRUCT_MS);
}

function showDestructWarning() {
  let w = $("destruct-warning");
  if (!w) {
    w = document.createElement("div");
    w.id = "destruct-warning";
    w.innerHTML = "Sesi hancur dalam <b>60 detik</b> — semua chat & data di perangkat ini akan dihapus.";
    document.body.appendChild(w);
  }
  w.classList.add("show");
  let s = 60;
  const iv = setInterval(() => {
    s--;
    if (s <= 0) { clearInterval(iv); return; }
    w.innerHTML = "Sesi hancur dalam <b>" + s + " detik</b> — semua chat & data di perangkat ini akan dihapus.";
  }, 1000);
}

async function selfDestruct() {
  // 1) hapus jejak aktivitas milik sendiri di server
  try { if (sb && me) await sb.from("users").delete().eq("id", me.id); } catch {}
  try { if (msgCh) await sb.removeChannel(msgCh); } catch {}
  try { if (presenceCh) await sb.removeChannel(presenceCh); } catch {}
  // 2) hancurkan cache lokal: identitas, nama, token sandi
  try {
    localStorage.removeItem(LS_ID);
    localStorage.removeItem(LS_NAME);
    sessionStorage.clear();
  } catch {}
  // 3) refresh otomatis → wajib masuk sandi lagi
  location.reload();
}

/* ---------- notif Telegram tiap login ---------- */
let loginNotified = false;
async function notifyLogin() {
  if (loginNotified) return;
  loginNotified = true;
  try {
    await fetch("/api/login-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: sessionStorage.getItem(LS_TOKEN), name: me.name }),
    });
  } catch {}
}

/* ---------- kirim ---------- */
function wireUI() {
  const input = $("msg-input");
  input.addEventListener("input", broadcastTyping);
  input.addEventListener("blur", broadcastTypingStop);
  $("composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    broadcastTypingStop();
    const body = input.value.trim();
    if (!body) return;
    input.value = "";

    const tmpId = "t" + Date.now();
    const m = {
      id: tmpId, sender_id: me.id, sender_name: me.name,
      body: body.slice(0, 2000), created_at: new Date().toISOString(),
      delivered_to: [], read_by: [],
    };
    appendMessage(m, true);
    scrollBottom();

    const { data, error } = await sb.from("messages")
      .insert({ room_id: LOBBY_ID, sender_id: me.id, sender_name: me.name, body: m.body })
      .select("id,created_at").single();
    if (error) {
      document.querySelector('[data-mid="' + tmpId + '"]')?.remove();
      renderedIds.delete(tmpId); msgCache.delete(tmpId);
      alert("Gagal kirim: " + error.message);
      return;
    }
    const el = document.querySelector('[data-mid="' + tmpId + '"]');
    if (el) {
      el.dataset.mid = data.id;
      const meta = el.querySelector(".msg-meta");
      if (meta) meta.innerHTML = fmtTime(data.created_at) + tickHTML("sent");
    }
    renderedIds.delete(tmpId); renderedIds.add(data.id);
    msgCache.delete(tmpId);
    msgCache.set(data.id, { ...m, id: data.id, created_at: data.created_at });
  });

  $("btn-online").onclick = () => {
    $("online-panel").classList.toggle("hidden");
    refreshOnlineList();
  };
}
