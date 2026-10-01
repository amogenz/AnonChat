/* ============================================================
 * AnonChat v3 — simpel: isi nama → lihat siapa online → ngobrol
 * Satu lobby publik. Chat otomatis hilang setelah 24 jam.
 * ============================================================ */

const LOBBY_ID = "00000000-0000-0000-0000-000000000001";
const LS_ID = "ac_id";
const LS_NAME = "ac_name";
const ONLINE_MS = 90000;       // dianggap online kalau last_seen < 90 dtk
const HEARTBEAT_MS = 20000;
const MSG_TTL_MS = 24 * 3600 * 1000; // chat kedaluwarsa setelah 24 jam

let sb = null;
let me = null;                 // { id, code, name }
let msgCh = null, presenceCh = null;
let renderedIds = new Set();
let msgCache = new Map();      // mid -> msg
let typingUsers = new Map();   // user_id -> { name, timeout }
let typingSentAt = 0;
let typingStopTimer = null;
let onlineTimer = null;

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

/* ---------- boot ---------- */
window.addEventListener("DOMContentLoaded", async () => {
  if (!isConfigured()) {
    $("config-warning").classList.remove("hidden");
    $("modal-nick").classList.add("hidden");
    return;
  }
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  me = loadIdentity();

  if (!me.name) {
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
});

async function boot() {
  await sb.from("users").upsert(
    { id: me.id, code: me.code, name: me.name, last_seen: new Date().toISOString(), active_room_id: LOBBY_ID },
    { onConflict: "id" }
  );
  await purgeExpired();          // hapus chat > 24 jam (fitur default)
  wireUI();
  setupPresence();
  setInterval(heartbeat, HEARTBEAT_MS);
  await loadMessages();
  subscribeMessages();
  await refreshOnlineList();
  onlineTimer = setInterval(refreshOnlineList, 15000);
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

/* ---------- presence: hitung & daftar yang online ---------- */
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
  updateStatus();
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
  updateStatus((data || []).length);
}

function updateStatus(onlineN) {
  const el = $("chat-status");
  if (typingUsers.size) { renderTyping(); return; }
  el.classList.remove("online", "typing");
  if (typeof onlineN === "number") {
    el.textContent = onlineN > 1 ? onlineN + " online" : "hanya kamu di sini";
    if (onlineN > 1) el.classList.add("online");
  }
}

/* ---------- pesan ---------- */
function scrollBottom() {
  const box = $("messages");
  box.scrollTop = box.scrollHeight;
}

function appendMessage(m) {
  if (renderedIds.has(m.id)) return;
  renderedIds.add(m.id);
  msgCache.set(m.id, m);

  const box = $("messages");
  const prev = box.querySelector(".msg:last-of-type");
  const prevM = prev ? msgCache.get(prev.dataset.mid) : null;
  const dayChanged = !prevM || new Date(prevM.created_at).toDateString() !== new Date(m.created_at).toDateString();
  if (dayChanged) {
    const d = document.createElement("div");
    d.className = "day-pill";
    d.textContent = fmtDay(m.created_at);
    box.appendChild(d);
  }

  const own = m.sender_id === me.id;
  const grouped = prevM && prevM.sender_id === m.sender_id &&
    (new Date(m.created_at) - new Date(prevM.created_at)) < 5 * 60000 && !dayChanged;

  const el = document.createElement("div");
  el.className = "msg " + (own ? "out" : "in") + (grouped ? " grouped" : "");
  el.dataset.mid = m.id;
  el.innerHTML =
    '<div class="bubble">' +
      (!own ? '<div class="sender" style="color:' + senderColor(m.sender_id) + '">' + escapeHtml(m.sender_name) + "</div>" : "") +
      '<span class="body">' + escapeHtml(m.body) + "</span>" +
      '<span class="msg-meta">' + fmtTime(m.created_at) + "</span>" +
    "</div>";
  box.appendChild(el);
}

async function loadMessages() {
  const cutoff = new Date(Date.now() - MSG_TTL_MS).toISOString();
  const { data } = await sb.from("messages")
    .select("id,sender_id,sender_name,body,created_at")
    .eq("room_id", LOBBY_ID)
    .gt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(100);
  (data || []).forEach(appendMessage);
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
          appendMessage(m);
          scrollBottom();
        }
      })
    .on("broadcast", { event: "typing" }, (p) => handleTyping(p.payload))
    .on("broadcast", { event: "typing_stop" }, (p) => handleTypingStop(p.payload))
    .subscribe();
}

/* ---------- indikator mengetik ---------- */
function clearTyping() {
  typingUsers.forEach((t) => clearTimeout(t.timeout));
  typingUsers.clear();
  clearTimeout(typingStopTimer);
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
  if (msgCh) msgCh.send({ type: "broadcast", event: "typing_stop", payload: { user_id: me.id } });
}

function handleTyping(p) {
  if (!p || p.user_id === me.id) return;
  clearTimeout(typingUsers.get(p.user_id)?.timeout);
  const timeout = setTimeout(() => { typingUsers.delete(p.user_id); renderTyping(); }, 3500);
  typingUsers.set(p.user_id, { name: p.name, timeout });
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
    el.textContent = names.length === 1 ? "mengetik..." : names.length + " orang mengetik...";
    el.classList.add("online", "typing");
  } else {
    el.classList.remove("typing");
    refreshOnlineList();
  }
}

/* ---------- kirim ---------- */
function wireUI() {
  $("msg-input").addEventListener("input", broadcastTyping);
  $("composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    broadcastTypingStop();
    const input = $("msg-input");
    const body = input.value.trim();
    if (!body) return;
    input.value = "";

    const tmpId = "t" + Date.now();
    const m = {
      id: tmpId, sender_id: me.id, sender_name: me.name,
      body: body.slice(0, 2000), created_at: new Date().toISOString(),
    };
    appendMessage(m);
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
      if (meta) meta.textContent = fmtTime(data.created_at);
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
