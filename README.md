# AnonChat — Web Chat Anonim ala WhatsApp

Tanpa nomor HP, tanpa password, tanpa daftar. Buka web → pilih nama samaran → langsung ngobrol.

**Fitur:**
- 🏠 **Lobby Publik** — semua orang ngobrol bareng + indikator "X online"
- ➕ **Bikin Room sendiri** — room publik bebas (pembuat bisa hapus)
- 💬 **DM privat** — via kode 6 karakter (mis. `X7K2Q9`), tanpa perlu tukaran nomor
- ⚡ **Realtime** — pesan masuk langsung via Supabase Realtime
- 📱 **Responsif** — enak di HP maupun laptop

## Cara menjalankan (5 menit)

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
- **Vercel**: drag folder ke vercel.com, atau `vercel` via CLI
- **GitHub Pages / Netlify / Cloudflare Pages**: upload folder apa adanya
- **Lokal**: `npx serve .` lalu buka http://localhost:3000

## Cara pakai
1. Buka web → isi nama samaran → otomatis dapat **kode unik** (klik kode buat nyalin)
2. **DM**: kasih kodemu ke teman → dia klik **+ DM** → tempel kodemu → jadi ruang privat
3. **Room**: klik **+ Room** → kasih nama → semua orang bisa join

## Catatan penting (jujur-jujuran)
- **"Privat" di sini = privat by obscurity.** DM cuma berupa room yang ID-nya tidak dipublikasikan — tanpa login, nggak ada enkripsi end-to-end. Jangan pakai buat rahasia serius.
- **Akses database terbuka** (sesuai konsep anonim): siapa pun yang pegang anon key bisa baca/tulis. Untuk projek santai oke; untuk produksi butuh rate-limit & moderasi.
- Identitas (nama + ID acak) tersimpan di `localStorage` — ganti browser/HP = jadi "orang baru". Itu bagian dari konsep anonimnya.

## Struktur file
```
anonchat/
├── index.html            # UI: sidebar + panel chat + modal
├── style.css             # tema gelap ala WhatsApp
├── app.js                # logika: identitas, room, DM, realtime, presence
├── config.js             # ← ISI INI: URL + anon key Supabase
├── supabase-schema.sql   # schema database (dijalankan sekali)
└── README.md
```
