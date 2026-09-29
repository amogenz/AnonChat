-- ============================================================
-- AnonChat — schema database (Supabase / Postgres)
-- Chat anonim ala WhatsApp: tanpa nomor HP, tanpa password.
-- Cara pakai: copy-paste seluruh file ini ke Supabase
-- Dashboard > SQL Editor > New Query > Run.
-- ============================================================

-- 1) Tabel user anonim (identitas disimpan di localStorage HP/laptop)
create table if not exists users (
  id        uuid primary key,          -- dibuat acak oleh aplikasi
  code      text unique not null,      -- kode pendek 6 karakter, mis. "X7K2Q9"
  name      text not null,             -- nama samaran
  last_seen timestamptz default now()
);

-- 2) Tabel room: lobby publik, room buatan user, dan DM
create table if not exists rooms (
  id              uuid primary key default gen_random_uuid(),
  name            text,                                   -- null untuk DM
  type            text not null check (type in ('lobby','custom','dm')),
  created_by      uuid,
  participant_ids uuid[] default '{}',                   -- diisi untuk DM (2 user)
  created_at      timestamptz default now()
);

-- 3) Tabel pesan
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms(id) on delete cascade,
  sender_id   uuid not null,
  sender_name text not null,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz default now()
);
create index if not exists messages_room_idx on messages (room_id, created_at);

-- 4) Seed: satu lobby publik yang selalu ada
insert into rooms (id, name, type) values
  ('00000000-0000-0000-0000-000000000001', 'Lobby Publik', 'lobby')
on conflict (id) do nothing;

-- 5) Akses terbuka (sesuai konsep anonim: siapa pun yang punya
--    anon key bisa baca/tulis; JANGAN taruh data rahasia di sini)
alter table users    enable row level security;
alter table rooms    enable row level security;
alter table messages enable row level security;

drop policy if exists "open" on users;
drop policy if exists "open" on rooms;
drop policy if exists "open" on messages;

create policy "open" on users    for all using (true) with check (true);
create policy "open" on rooms    for all using (true) with check (true);
create policy "open" on messages for all using (true) with check (true);

-- 6) Nyalakan Realtime untuk tabel messages (biar chat live)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
