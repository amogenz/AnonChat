/* ============================================================
 * AnonChat v2 — UI WhatsApp iPhone + centang baca realtime
 * ✓ abu  = terkirim ke server
 * ✓✓ abu = diterima (lawan online / buka room)
 * ✓✓ biru= dibaca
 * ============================================================ */

const LOBBY_ID = "00000000-0000-0000-0000-000000000001";
const LS_ID = "ac_id";
const LS_NAME = "ac_name";
const ONLINE_MS = 90000;      // dianggap online kalau last_seen < 90 dtk
const HEARTBEAT_MS = 20000;

let sb = null;
let me = null;                // { id, code, name }
let activeRoom = null;        // { id, name, type, otherId }
let globalCh = null, presenceCh = null, readsCh = null, usersCh = null;
let dmCache = {};             // roomId -> nama lawan
let roomsMeta = [];           // [{id,name,type,created_by,otherId,otherName}]
let lastMsg = new Map();      // roomId -> {id,body,sender_id,sender_name,created_at}
let unread = new Map();       // roomId -> jumlah
let myReads = new Map();      // roomId -> last_read_at (punyaku)
let roomReads = new Map();    // roomId -> Map(userId -> last_read_at)
let roomOnline = new Map();   // roomId -> [{id,name,last_seen}]
let msgCache = new Map();     // mid -> msg (di room aktif)
let renderedIds = new Set();
let lobbyOnline = 0;
let currentFilter = "";
let markReadTimer = null;
let usersRefreshTimer = null;
let typingUsers = new Map();  // user_id -> { name, timeout }
let typingSentAt = 0;
let typingStopTimer = null;

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
function fmtListTime(iso) {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(iso);
  const y = new Date(); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Kemarin";
  if ((now - d) < 7 * 86400000) return d.toLocaleDateString("id-ID", { weekday: "long" });
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "2-digit" });
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

/* centang ala WA (SVG): sent | delivered | read */
const CHECK_PATH = "M4.6 8.4L1.8 5.6 0.4 7l4.2 4.2L12 3.8 10.6 2.4z";
function tickSvg(status) {
  if (!status) return "";
  const cls = "tick " + (status === "read" ? "blue" : "gray") + (status === "sent" ? "" : " double");
  const one = '<svg viewBox="0 0 12 11"><path d="' + CHECK_PATH + '" fill="currentColor"/></svg>';
  return '<span class="' + cls + '">' + one + (status === "sent" ? "" : one) + "</span>";
}
const COPY_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 14V6a2 2 0 012-2h8" stroke-linecap="round"/></svg>';

/* ---------- identitas ---------- */
function loadIdentity() {
  let id = localStorage.getItem(LS_ID);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(LS_ID, id); }
  return { id, code: id.replace(/-/g, "").slice(0, 6).toUpperCase(), name: localStorage.getItem(LS_NAME) || "" };
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
  renderProfile();
  await sb.from("users").upsert(
    { id: me.id, code: me.code, name: me.name, last_seen: new Date().toISOString(), active_room_id: null },
    { onConflict: "id" }
  );
  wireUI();
  await loadMyReads();
  subscribeGlobal();
  setupPresence();
  subscribeUsers();
  setInterval(heartbeat, HEARTBEAT_MS);
  await refreshLists();
  openRoom(LOBBY_ID, "Lobby Publik", "lobby");
}

function renderProfile() {
  $("profile-avatar").textContent = me.name.charAt(0).toUpperCase();
  $("profile-avatar").style.background = avatarColor(me.id);
  $("profile-name").textContent = me.name;
  $("profile-code-btn").innerHTML = "<span>" + escapeHtml(me.code) + "</span>" + COPY_SVG;
}

/* ---------- heartbeat & presence ---------- */
async function heartbeat() {
  if (!sb) return;
  await sb.from("users").update({
    last_seen: new Date().toISOString(),
    active_room_id: activeRoom ? activeRoom.id : null,
  }).eq("id", me.id);
}

function setupPresence() {
  presenceCh = sb.channel("lobby-presence", { config: { presence: { key: me.id } } });
  presenceCh.on("presence", { event: "sync" }, () => {
    lobbyOnline = Object.keys(presenceCh.presenceState()).length;
    updateChatStatus();
    renderList();
  }).subscribe(async (status) => {
    if (status === "SUBSCRIBED") await presenceCh.track({ id: me.id, name: me.name });
  });
}

function subscribeUsers() {
  usersCh = sb.channel("users-watch")
    .on("postgres_changes", { event: "*", schema: "public", table: "users" }, () => {
      clearTimeout(usersRefreshTimer);
      usersRefreshTimer = setTimeout(async () => {
        if (activeRoom) {
          await refreshRoomOnline(activeRoom.id);
          updateTicks();
          updateChatStatus();
        }
      }, 2000);
    })
    .subscribe();
}

async function refreshRoomOnline(roomId) {
  const since = new Date(Date.now() - ONLINE_MS).toISOString();
  const { data } = await sb.from("users")
    .select("id,name,last_seen")
    .eq("active_room_id", roomId)
    .gt("last_seen", since);
  roomOnline.set(roomId, data || []);
}

/* ---------- daftar chat ---------- */
async function loadMyReads() {
  const { data } = await sb.from("room_reads").select("room_id,last_read_at").eq("user_id", me.id);
  myReads = new Map((data || []).map((r) => [r.room_id, r.last_read_at]));
}

async function refreshLists() {
  const metas = [{ id: LOBBY_ID, name: "Lobby Publik", type: "lobby" }];

  const { data: customs } = await sb.from("rooms")
    .select("id,name,created_by,created_at").eq("type", "custom").order("created_at", { ascending: false });
  (customs || []).forEach((r) => metas.push({ id: r.id, name: r.name, type: "custom", created_by: r.created_by }));

  const { data: dms } = await sb.from("rooms")
    .select("id,participant_ids,created_at").eq("type", "dm")
    .contains("participant_ids", [me.id]).order("created_at", { ascending: false });
  for (const d of dms || []) {
    const otherId = (d.participant_ids || []).find((x) => x !== me.id);
    let otherName = dmCache[d.id];
    if (!otherName && otherId) {
      const { data: u } = await sb.from("users").select("name").eq("id", otherId).single();
      otherName = (u && u.name) || "Anonim";
      dmCache[d.id] = otherName;
    }
    metas.push({ id: d.id, name: otherName, type: "dm", otherId, otherName });
  }
  roomsMeta = metas;

  // pesan terakhir + unread per room
  for (const m of metas) {
    const { data: lm } = await sb.from("messages")
      .select("id,body,sender_id,sender_name,created_at")
      .eq("room_id", m.id).order("created_at", { ascending: false }).limit(1);
    if (lm && lm.length) lastMsg.set(m.id, lm[0]);
    const since = myReads.get(m.id);
    if (since) {
      const { count } = await sb.from("messages")
        .select("id", { count: "exact", head: true })
        .eq("room_id", m.id).neq("sender_id", me.id).gt("created_at", since);
      unread.set(m.id, count || 0);
    } else if (lm && lm.length) {
      unread.set(m.id, 0);
    }
  }
  renderList();
}

function roomById(id) { return roomsMeta.find((r) => r.id === id); }

function renderList() {
  const el = $("chat-list");
  const q = currentFilter.trim().toLowerCase();
  const rows = roomsMeta
    .filter((r) => !q || (r.name || "").toLowerCase().includes(q))
    .sort((a, b) => {
      const ta = lastMsg.get(a.id)?.created_at || "", tb = lastMsg.get(b.id)?.created_at || "";
      return tb.localeCompare(ta);
    });

  el.innerHTML = "";
  if (!rows.length) {
    el.innerHTML = '<div class="empty-note">Belum ada chat. Ketuk ✎ untuk mulai.</div>';
    return;
  }
  rows.forEach((r) => {
    const lm = lastMsg.get(r.id);
    const n = unread.get(r.id) || 0;
    const b = document.createElement("button");
    b.className = "chat-row";
    b.dataset.room = r.id;

    let preview = lm ? lm.body : (r.type === "lobby" ? lobbyOnline + " online" : r.type === "dm" ? "chat privat" : "room publik");
    let tick = "";
    if (lm && lm.sender_id === me.id) {
      tick = tickSvg(msgStatus({ ...lm, room_id: r.id }));
    }
    b.innerHTML =
      '<span class="avatar" style="background:' + avatarColor(r.type === "dm" ? r.otherId : r.id) + '">' +
        escapeHtml((r.name || "?").charAt(0).toUpperCase()) + "</span>" +
      '<span class="chat-main">' +
        '<span class="chat-line1"><span class="chat-name">' + escapeHtml(r.name || "?") + "</span>" +
        (lm ? '<span class="chat-time' + (n ? " unread" : "") + '">' + fmtListTime(lm.created_at) + "</span>" : "") +
        "</span>" +
        '<span class="chat-line2"><span class="chat-preview">' + tick + '<span class="body-text">' + escapeHtml(preview).slice(0, 60) + "</span></span>" +
        (n ? '<span class="unread-badge">' + n + "</span>" : "") +
        "</span>" +
      "</span>";

    // geser untuk hapus (room milik sendiri)
    if (r.type === "custom" && r.created_by === me.id) enableSwipeDelete(b, r);

    b.addEventListener("click", () => openRoom(r.id, r.name, r.type, r.otherId));
    el.appendChild(b);
  });
}

function enableSwipeDelete(row, room) {
  let sx = 0, dx = 0;
  row.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
  row.addEventListener("touchmove", (e) => {
    dx = e.touches[0].clientX - sx;
    if (dx < 0) row.style.transform = "translateX(" + Math.max(dx, -84) + "px)";
  }, { passive: true });
  row.addEventListener("touchend", () => {
    if (dx < -60) {
      if (confirm('Hapus room "' + room.name + '"?')) deleteRoom(room.id, room.name);
    }
    row.style.transform = "";
    dx = 0;
  });
}

/* ---------- buka / tutup room ---------- */
async function openRoom(id, name, type, otherId) {
  activeRoom = { id, name, type, otherId: otherId || null };
  renderedIds = new Set();
  msgCache = new Map();

  $("chat-name").textContent = name;
  const av = $("chat-avatar");
  av.textContent = (name || "?").charAt(0).toUpperCase();
  av.style.background = avatarColor(type === "dm" && otherId ? otherId : id);
  $("messages").innerHTML = "";
  $("msg-input").value = "";
  $("view-chat").classList.add("open");
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));

  setActiveRoom(id);
  await loadRoomReads(id);
  await refreshRoomOnline(id);

  const { data } = await sb.from("messages")
    .select("id,sender_id,sender_name,body,created_at")
    .eq("room_id", id).order("created_at", { ascending: true }).limit(100);
  (data || []).forEach((m) => appendMessage({ ...m, room_id: id }));
  scrollBottom();
  updateChatStatus();

  if (readsCh) sb.removeChannel(readsCh);
  clearTyping();
  readsCh = sb.channel("reads:" + id, { config: { broadcast: { self: false } } })
    .on("postgres_changes",
      { event: "*", schema: "public", table: "room_reads", filter: "room_id=eq." + id },
      (p) => {
        const r = p.new;
        if (!r || !r.user_id) return;
        if (!roomReads.has(id)) roomReads.set(id, new Map());
        roomReads.get(id).set(r.user_id, r.last_read_at);
        updateTicks();
      })
    .on("broadcast", { event: "typing" }, (p) => handleTyping(p.payload))
    .on("broadcast", { event: "typing_stop" }, (p) => handleTypingStop(p.payload))
    .subscribe();

  scheduleMarkRead();
}

function closeChat() {
  $("view-chat").classList.remove("open");
  setActiveRoom(null);
  clearTyping();
  if (readsCh) { sb.removeChannel(readsCh); readsCh = null; }
  activeRoom = null;
}

/* ---------- indikator mengetik (realtime, via broadcast) ---------- */
function clearTyping() {
  typingUsers.forEach((t) => clearTimeout(t.timeout));
  typingUsers.clear();
  clearTimeout(typingStopTimer);
}

function broadcastTyping() {
  if (!readsCh || !activeRoom) return;
  const now = Date.now();
  if (now - typingSentAt > 2500) {
    typingSentAt = now;
    readsCh.send({ type: "broadcast", event: "typing", payload: { user_id: me.id, name: me.name } });
  }
  clearTimeout(typingStopTimer);
  typingStopTimer = setTimeout(broadcastTypingStop, 3000);
}

function broadcastTypingStop() {
  if (readsCh && activeRoom) {
    readsCh.send({ type: "broadcast", event: "typing_stop", payload: { user_id: me.id } });
  }
}

function handleTyping(p) {
  if (!p || p.user_id === me.id || !activeRoom) return;
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
  if (!activeRoom) return;
  const el = $("chat-status");
  if (typingUsers.size) {
    const names = [...typingUsers.values()].map((t) => t.name);
    el.textContent = names.length === 1 ? "mengetik..." : names.length + " orang mengetik...";
    el.classList.add("online");
    el.classList.add("typing");
  } else {
    el.classList.remove("typing");
    updateChatStatus();
  }
}

async function setActiveRoom(id) {
  if (!sb) return;
  await sb.from("users").update({
    active_room_id: id,
    last_seen: new Date().toISOString(),
  }).eq("id", me.id);
}

async function loadRoomReads(roomId) {
  const { data } = await sb.from("room_reads").select("user_id,last_read_at").eq("room_id", roomId);
  roomReads.set(roomId, new Map((data || []).map((r) => [r.user_id, r.last_read_at])));
}

/* ---------- status chat di header ---------- */
async function updateChatStatus() {
  if (!activeRoom) return;
  if (typingUsers.size) { renderTyping(); return; }
  const el = $("chat-status");
  el.classList.remove("online");
  if (activeRoom.type === "lobby") {
    el.textContent = lobbyOnline > 0 ? lobbyOnline + " online" : "semua orang";
  } else if (activeRoom.type === "dm" && activeRoom.otherId) {
    const { data: u } = await sb.from("users").select("last_seen").eq("id", activeRoom.otherId).single();
    const online = u && (Date.now() - new Date(u.last_seen).getTime()) < ONLINE_MS;
    el.textContent = online ? "online" : ("terakhir dilihat " + (u ? fmtTime(u.last_seen) : "—"));
    if (online) el.classList.add("online");
  } else {
    const n = (roomOnline.get(activeRoom.id) || []).length;
    el.textContent = n > 0 ? n + " online" : "room publik";
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
  const status = msgStatus(m);
  el.innerHTML =
    '<div class="bubble">' +
      (!own ? '<div class="sender" style="color:' + senderColor(m.sender_id) + '">' + escapeHtml(m.sender_name) + "</div>" : "") +
      '<span class="body">' + escapeHtml(m.body) + "</span>" +
      '<span class="msg-meta">' + fmtTime(m.created_at) +
        (status ? " " + tickSvg(status) : "") +
      "</span>" +
    "</div>";
  box.appendChild(el);
}

/* status: sent | delivered | read (null utk pesan orang lain) */
function msgStatus(m) {
  if (!m || m.sender_id !== me.id) return null;
  const online = (roomOnline.get(m.room_id) || []).filter((u) => u.id !== me.id);
  if (!online.length) return "sent";
  const reads = roomReads.get(m.room_id) || new Map();
  const mt = new Date(m.created_at).getTime();
  const allRead = online.every((u) => {
    const r = reads.get(u.id);
    return r && new Date(r).getTime() >= mt;
  });
  return allRead ? "read" : "delivered";
}

function updateTicks() {
  document.querySelectorAll("#messages .msg").forEach((el) => {
    const m = msgCache.get(el.dataset.mid);
    if (!m || m.sender_id !== me.id) return;
    const status = msgStatus(m);
    const html = tickSvg(status);
    if (tick) tick.outerHTML = html;
    else el.querySelector(".msg-meta").insertAdjacentHTML("beforeend", " " + html);
  });
  renderList();
}

/* ---------- tandai dibaca ---------- */
function scheduleMarkRead() {
  clearTimeout(markReadTimer);
  markReadTimer = setTimeout(doMarkRead, 800);
}
async function doMarkRead() {
  if (!activeRoom || !sb || document.hidden) return;
  const now = new Date().toISOString();
  await sb.from("room_reads").upsert(
    { room_id: activeRoom.id, user_id: me.id, last_read_at: now },
    { onConflict: "room_id,user_id" }
  );
  myReads.set(activeRoom.id, now);
  unread.set(activeRoom.id, 0);
  renderList();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleMarkRead(); });

/* ---------- kirim ---------- */
function wireComposer() {
  $("msg-input").addEventListener("input", broadcastTyping);
  $("composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    broadcastTypingStop();
    const input = $("msg-input");
    const body = input.value.trim();
    if (!body || !activeRoom) return;
    input.value = "";

    const tmpId = "t" + Date.now();
    const m = {
      id: tmpId, room_id: activeRoom.id, sender_id: me.id,
      sender_name: me.name, body: body.slice(0, 2000),
      created_at: new Date().toISOString(),
    };
    appendMessage(m);
    scrollBottom();
    scheduleMarkRead();

    const { data, error } = await sb.from("messages")
      .insert({ room_id: m.room_id, sender_id: me.id, sender_name: me.name, body: m.body })
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
      if (meta) meta.childNodes[0].textContent = fmtTime(data.created_at) + " ";
    }
    renderedIds.delete(tmpId); renderedIds.add(data.id);
    msgCache.delete(tmpId);
    msgCache.set(data.id, { ...m, id: data.id, created_at: data.created_at });
    lastMsg.set(activeRoom.id, { ...m, id: data.id, created_at: data.created_at });
    updateTicks();
  });
}

/* ---------- langganan global pesan baru ---------- */
function subscribeGlobal() {
  globalCh = sb.channel("all-messages")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" },
      (p) => {
        const m = { ...p.new, room_id: p.new.room_id };
        if (renderedIds.has(m.id)) return;
        if (activeRoom && m.room_id === activeRoom.id) {
          if (m.sender_id !== me.id) {
            appendMessage(m);
            scrollBottom();
            scheduleMarkRead();
          }
        } else {
          lastMsg.set(m.room_id, m);
          if (m.sender_id !== me.id) unread.set(m.room_id, (unread.get(m.room_id) || 0) + 1);
          if (!roomById(m.room_id)) refreshLists();
          else renderList();
        }
      })
    .subscribe();
}

/* ---------- UI: tab, sheet, modal, tombol ---------- */
function wireUI() {
  wireComposer();

  document.querySelectorAll(".tab").forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      const isChats = t.dataset.tab === "chats";
      $("pane-chats").classList.toggle("hidden", !isChats);
      $("pane-me").classList.toggle("hidden", isChats);
    };
  });

  $("btn-compose").onclick = () => $("sheet-backdrop").classList.remove("hidden");
  $("btn-plus").onclick = () => $("sheet-backdrop").classList.remove("hidden");
  $("sheet-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "sheet-backdrop") $("sheet-backdrop").classList.add("hidden");
  });
  document.querySelectorAll(".sheet-btn").forEach((b) => {
    b.onclick = () => {
      const act = b.dataset.act;
      $("sheet-backdrop").classList.add("hidden");
      if (act === "room") { $("modal-room").classList.remove("hidden"); $("room-name-input").value = ""; $("room-name-input").focus(); }
      if (act === "dm") { $("modal-dm").classList.remove("hidden"); $("dm-code-input").value = ""; $("dm-code-input").focus(); }
      if (act === "code") copyMyCode();
    };
  });

  $("btn-back").onclick = closeChat;

  // geser dari tepi kiri untuk kembali (iOS)
  let sx = 0;
  $("view-chat").addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
  $("view-chat").addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    if (sx < 28 && dx > 90) closeChat();
  }, { passive: true });

  $("search").addEventListener("input", (e) => { currentFilter = e.target.value; renderList(); });

  $("room-cancel").onclick = () => $("modal-room").classList.add("hidden");
  $("room-ok").onclick = async () => {
    const name = $("room-name-input").value.trim().slice(0, 40);
    if (!name) return;
    $("modal-room").classList.add("hidden");
    const { data, error } = await sb.from("rooms")
      .insert({ name, type: "custom", created_by: me.id }).select("id").single();
    if (error) { alert("Gagal bikin room: " + error.message); return; }
    await refreshLists();
    openRoom(data.id, name, "custom");
  };

  $("dm-cancel").onclick = () => $("modal-dm").classList.add("hidden");
  $("dm-ok").onclick = startDm;
  $("dm-code-input").addEventListener("keydown", (e) => { if (e.key === "Enter") startDm(); });

  $("btn-edit-name").onclick = () => {
    $("modal-name").classList.remove("hidden");
    $("name-input").value = me.name;
    $("name-input").focus();
  };
  $("name-cancel").onclick = () => $("modal-name").classList.add("hidden");
  $("name-ok").onclick = async () => {
    const v = $("name-input").value.trim().slice(0, 24);
    if (!v) return;
    me.name = v;
    localStorage.setItem(LS_NAME, v);
    await sb.from("users").update({ name: v }).eq("id", me.id);
    $("modal-name").classList.add("hidden");
    renderProfile();
  };

  $("profile-code-btn").onclick = copyMyCode;
}

async function copyMyCode() {
  try {
    await navigator.clipboard.writeText(me.code);
    const b = $("profile-code-btn");
    b.innerHTML = "<span>tersalin!</span>" + COPY_SVG;
    setTimeout(() => { b.innerHTML = "<span>" + escapeHtml(me.code) + "</span>" + COPY_SVG; }, 1500);
  } catch { /* clipboard tak tersedia */ }
}

async function startDm() {
  const code = $("dm-code-input").value.trim().toUpperCase();
  if (code.length !== 6) { alert("Kode harus 6 karakter."); return; }
  if (code === me.code) { alert("Itu kodemu sendiri, brey 😄"); return; }

  const { data: user } = await sb.from("users").select("id,name").eq("code", code).single();
  if (!user) { alert("Kode tidak ditemukan. Minta kode yang benar ke temanmu."); return; }
  $("modal-dm").classList.add("hidden");

  const { data: existing } = await sb.from("rooms")
    .select("id").eq("type", "dm").contains("participant_ids", [me.id, user.id]).limit(1);
  if (existing && existing.length) {
    dmCache[existing[0].id] = user.name;
    await refreshLists();
    openRoom(existing[0].id, user.name, "dm", user.id);
    return;
  }
  const { data: room, error } = await sb.from("rooms")
    .insert({ type: "dm", created_by: me.id, participant_ids: [me.id, user.id] })
    .select("id").single();
  if (error) { alert("Gagal mulai DM: " + error.message); return; }
  dmCache[room.id] = user.name;
  await refreshLists();
  openRoom(room.id, user.name, "dm", user.id);
}

async function deleteRoom(id, name) {
  const { error } = await sb.from("rooms").delete().eq("id", id).eq("created_by", me.id);
  if (error) { alert("Gagal hapus: " + error.message); return; }
  if (activeRoom && activeRoom.id === id) { closeChat(); openRoom(LOBBY_ID, "Lobby Publik", "lobby"); }
  refreshLists();
}
