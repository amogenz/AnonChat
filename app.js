/* ============================================================
 * AnonChat — logika aplikasi
 * Anonim: identitas (id acak + nama samaran) disimpan di
 * localStorage perangkat masing-masing. Tanpa nomor HP/password.
 * ============================================================ */

const LOBBY_ID = "00000000-0000-0000-0000-000000000001";
const LS_ID = "ac_id";
const LS_NAME = "ac_name";

let sb = null;          // supabase client
let me = null;          // { id, code, name }
let activeRoom = null;  // { id, name, type }
let roomChannel = null; // subscription pesan aktif
let presenceChannel = null;
let dmCache = {};       // roomId -> nama lawan DM

/* ---------- util ---------- */
const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }).replace(".", ":");
}

function fmtDay(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hari ini";
  if (d.toDateString() === yesterday.toDateString()) return "Kemarin";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

function isConfigured() {
  return typeof SUPABASE_URL === "string"
    && !SUPABASE_URL.includes("ISI-DENGAN")
    && typeof SUPABASE_ANON_KEY === "string"
    && !SUPABASE_ANON_KEY.includes("ISI-DENGAN");
}

/* ---------- identitas anonim ---------- */
function loadIdentity() {
  let id = localStorage.getItem(LS_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(LS_ID, id);
  }
  const code = id.replace(/-/g, "").slice(0, 6).toUpperCase();
  const name = localStorage.getItem(LS_NAME) || "";
  return { id, code, name };
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
    $("modal-nick").classList.remove("hidden");
    $("nick-input").focus();
    $("nick-ok").onclick = () => {
      const v = $("nick-input").value.trim().slice(0, 24);
      if (!v) { $("nick-input").focus(); return; }
      me.name = v;
      localStorage.setItem(LS_NAME, v);
      $("modal-nick").classList.add("hidden");
      boot();
    };
    $("nick-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("nick-ok").click();
    });
  } else {
    $("modal-nick").classList.add("hidden");
    boot();
  }
});

async function boot() {
  renderMe();
  // daftarkan / perbarui baris user-ku
  await sb.from("users").upsert(
    { id: me.id, code: me.code, name: me.name, last_seen: new Date().toISOString() },
    { onConflict: "id" }
  );
  wireButtons();
  await refreshLists();
  openRoom(LOBBY_ID, "Lobby Publik", "lobby");
  setupPresence();
  // refresh last_seen tiap 2 menit
  setInterval(() => {
    sb.from("users").update({ last_seen: new Date().toISOString() }).eq("id", me.id);
  }, 120000);
}

function renderMe() {
  $("my-name").textContent = me.name;
  $("my-code").textContent = me.code;
  $("my-avatar").textContent = me.name.charAt(0).toUpperCase();
}

/* ---------- daftar room ---------- */
async function refreshLists() {
  // custom rooms (publik, semua orang bisa lihat & join)
  const { data: customs } = await sb.from("rooms")
    .select("id,name,created_by,created_at")
    .eq("type", "custom").order("created_at", { ascending: false });
  renderRoomList($("custom-room-list"), customs || [], "custom");

  // DM-ku
  const { data: dms } = await sb.from("rooms")
    .select("id,participant_ids,created_at")
    .eq("type", "dm").contains("participant_ids", [me.id])
    .order("created_at", { ascending: false });
  await renderDmList(dms || []);

  // lobby statis
  renderRoomList($("lobby-list"),
    [{ id: LOBBY_ID, name: "Lobby Publik", sub: "semua orang" }], "lobby");
}

function renderRoomList(el, rooms, kind) {
  el.innerHTML = "";
  if (!rooms.length) {
    el.innerHTML = '<div class="empty-note">Belum ada. Bikin satu?</div>';
    return;
  }
  rooms.forEach((r) => {
    const b = document.createElement("button");
    b.className = "room-item" + (activeRoom && activeRoom.id === r.id ? " active" : "");
    b.innerHTML =
      '<div class="avatar">' + escapeHtml((r.name || "?").charAt(0).toUpperCase()) + "</div>" +
      '<div class="room-meta"><div class="room-name">' + escapeHtml(r.name || "?") + "</div>" +
      '<div class="room-sub">' + escapeHtml(r.sub || (kind === "custom" ? "room publik" : "")) + "</div></div>";
    if (kind === "custom" && r.created_by === me.id) {
      const del = document.createElement("span");
      del.className = "del-room";
      del.textContent = "🗑";
      del.title = "Hapus room";
      del.onclick = (e) => { e.stopPropagation(); deleteRoom(r.id, r.name); };
      b.appendChild(del);
    }
    b.onclick = () => openRoom(r.id, r.name, kind);
    el.appendChild(b);
  });
}

async function renderDmList(dms) {
  const el = $("dm-list");
  el.innerHTML = "";
  if (!dms.length) {
    el.innerHTML = '<div class="empty-note">Belum ada DM.</div>';
    return;
  }
  for (const d of dms) {
    const otherId = (d.participant_ids || []).find((x) => x !== me.id);
    let otherName = dmCache[d.id];
    if (!otherName && otherId) {
      const { data } = await sb.from("users").select("name").eq("id", otherId).single();
      otherName = (data && data.name) || "Anonim";
      dmCache[d.id] = otherName;
    }
    const b = document.createElement("button");
    b.className = "room-item" + (activeRoom && activeRoom.id === d.id ? " active" : "");
    b.innerHTML =
      '<div class="avatar">' + escapeHtml((otherName || "?").charAt(0).toUpperCase()) + "</div>" +
      '<div class="room-meta"><div class="room-name">' + escapeHtml(otherName || "?") + "</div>" +
      '<div class="room-sub">chat privat</div></div>';
    b.onclick = () => openRoom(d.id, otherName, "dm");
    el.appendChild(b);
  }
}

/* ---------- buka room & realtime ---------- */
async function openRoom(id, name, type) {
  activeRoom = { id, name, type };
  document.querySelectorAll(".room-item").forEach((el) => el.classList.remove("active"));

  $("chat-name").textContent = name;
  $("chat-avatar").textContent = (name || "?").charAt(0).toUpperCase();
  $("chat-sub").textContent =
    type === "lobby" ? "semua orang" : type === "dm" ? "ruang privat" : "room publik";
  $("messages").innerHTML = "";
  $("msg-input").value = "";

  if (window.innerWidth <= 720) {
    $("sidebar").classList.add("mobile-hidden");
    $("chat").classList.remove("mobile-hidden");
    $("btn-back").classList.remove("hidden");
  }

  // muat riwayat (100 terakhir)
  const { data } = await sb.from("messages")
    .select("sender_id,sender_name,body,created_at")
    .eq("room_id", id).order("created_at", { ascending: true }).limit(100);
  let lastDay = "";
  (data || []).forEach((m) => { lastDay = appendMessage(m, lastDay); });
  scrollBottom();

  // langganan pesan baru
  if (roomChannel) sb.removeChannel(roomChannel);
  roomChannel = sb.channel("room:" + id)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: "room_id=eq." + id },
      (payload) => {
        const m = payload.new;
        if (m.sender_id === me.id) return; // pesanku sudah tampil (optimistic)
        appendMessage(m, currentLastDay());
        scrollBottom();
      })
    .subscribe();
}

function currentLastDay() {
  const divs = document.querySelectorAll("#messages .day-divider");
  return divs.length ? divs[divs.length - 1].dataset.day : "";
}

function appendMessage(m, lastDay) {
  const box = $("messages");
  const day = new Date(m.created_at).toDateString();
  if (day !== lastDay) {
    const d = document.createElement("div");
    d.className = "day-divider";
    d.dataset.day = day;
    d.textContent = fmtDay(m.created_at);
    box.appendChild(d);
    lastDay = day;
  }
  const own = m.sender_id === me.id;
  const el = document.createElement("div");
  el.className = "msg " + (own ? "out" : "in");
  el.innerHTML =
    '<div class="sender">' + escapeHtml(m.sender_name) + "</div>" +
    '<span class="body">' + escapeHtml(m.body) + "</span>" +
    '<span class="time">' + fmtTime(m.created_at) + "</span>";
  box.appendChild(el);
  return lastDay;
}

function scrollBottom() {
  const box = $("messages");
  box.scrollTop = box.scrollHeight;
}

/* ---------- kirim pesan ---------- */
$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("msg-input");
  const body = input.value.trim();
  if (!body || !activeRoom) return;
  input.value = "";

  const m = {
    room_id: activeRoom.id,
    sender_id: me.id,
    sender_name: me.name,
    body: body.slice(0, 2000),
    created_at: new Date().toISOString(),
  };
  appendMessage(m, currentLastDay()); // tampil langsung (optimistic)
  scrollBottom();

  const { error } = await sb.from("messages").insert({
    room_id: m.room_id, sender_id: m.sender_id,
    sender_name: m.sender_name, body: m.body,
  });
  if (error) alert("Gagal kirim: " + error.message);
});

/* ---------- presence (yang online di lobby) ---------- */
function setupPresence() {
  presenceChannel = sb.channel("lobby-presence", {
    config: { presence: { key: me.id } },
  });
  presenceChannel
    .on("presence", { event: "sync" }, () => {
      const n = Object.keys(presenceChannel.presenceState()).length;
      const lobbySub = document.querySelector('#lobby-list .room-sub');
      if (lobbySub) lobbySub.textContent = n > 0 ? n + " online" : "semua orang";
      if (activeRoom && activeRoom.type === "lobby") {
        $("chat-sub").textContent = n > 0 ? n + " online" : "semua orang";
      }
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await presenceChannel.track({ id: me.id, name: me.name });
      }
    });
}

/* ---------- aksi: room, dm, hapus ---------- */
function wireButtons() {
  $("my-code-btn").onclick = async () => {
    try {
      await navigator.clipboard.writeText(me.code);
      $("my-code-btn").innerHTML = "tersalin! ✓";
      setTimeout(() => {
        $("my-code-btn").innerHTML = "kode: <b>" + me.code + "</b> ⧉";
      }, 1500);
    } catch { /* clipboard tak tersedia */ }
  };

  $("btn-new-room").onclick = () => {
    $("modal-room").classList.remove("hidden");
    $("room-name-input").value = "";
    $("room-name-input").focus();
  };
  $("room-cancel").onclick = () => $("modal-room").classList.add("hidden");
  $("room-ok").onclick = async () => {
    const name = $("room-name-input").value.trim().slice(0, 40);
    if (!name) return;
    $("modal-room").classList.add("hidden");
    const { data, error } = await sb.from("rooms")
      .insert({ name, type: "custom", created_by: me.id })
      .select("id").single();
    if (error) { alert("Gagal bikin room: " + error.message); return; }
    await refreshLists();
    openRoom(data.id, name, "custom");
  };

  $("btn-new-dm").onclick = () => {
    $("modal-dm").classList.remove("hidden");
    $("dm-code-input").value = "";
    $("dm-code-input").focus();
  };
  $("dm-cancel").onclick = () => $("modal-dm").classList.add("hidden");
  $("dm-ok").onclick = startDm;

  $("btn-back").onclick = () => {
    $("chat").classList.add("mobile-hidden");
    $("sidebar").classList.remove("mobile-hidden");
  };
}

async function startDm() {
  const code = $("dm-code-input").value.trim().toUpperCase();
  if (code.length !== 6) { alert("Kode harus 6 karakter."); return; }
  if (code === me.code) { alert("Itu kodemu sendiri, brey 😄"); return; }

  const { data: user } = await sb.from("users").select("id,name").eq("code", code).single();
  if (!user) { alert("Kode tidak ditemukan. Minta kode yang benar ke temanmu."); return; }
  $("modal-dm").classList.add("hidden");

  // cari DM yang sudah ada antara aku & dia
  const { data: existing } = await sb.from("rooms")
    .select("id").eq("type", "dm").contains("participant_ids", [me.id, user.id]).limit(1);
  if (existing && existing.length) {
    dmCache[existing[0].id] = user.name;
    await refreshLists();
    openRoom(existing[0].id, user.name, "dm");
    return;
  }
  const { data: room, error } = await sb.from("rooms")
    .insert({ type: "dm", created_by: me.id, participant_ids: [me.id, user.id] })
    .select("id").single();
  if (error) { alert("Gagal mulai DM: " + error.message); return; }
  dmCache[room.id] = user.name;
  await refreshLists();
  openRoom(room.id, user.name, "dm");
}

async function deleteRoom(id, name) {
  if (!confirm('Hapus room "' + name + '"? Semua pesannya ikut hilang.')) return;
  const { error } = await sb.from("rooms").delete().eq("id", id).eq("created_by", me.id);
  if (error) { alert("Gagal hapus: " + error.message); return; }
  if (activeRoom && activeRoom.id === id) openRoom(LOBBY_ID, "Lobby Publik", "lobby");
  refreshLists();
}
