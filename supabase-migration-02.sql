-- ============================================================
-- AnonChat — migrasi 02: indikator pesan dibaca (read receipts)
-- Cara pakai: copy-paste ke Supabase Dashboard > SQL Editor > Run.
-- Aman dijalankan berulang (idempotent).
-- ============================================================

-- 1) Lacak room yang sedang dibuka tiap user (untuk presence per-room)
alter table users add column if not exists active_room_id uuid;

-- 2) Posisi baca tiap user per room
create table if not exists room_reads (
  room_id      uuid not null references rooms(id) on delete cascade,
  user_id      uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table room_reads enable row level security;
drop policy if exists "open" on room_reads;
create policy "open" on room_reads
  for all using (true) with check (true);

-- 3) Nyalakan Realtime untuk tabel room_reads & users
--    (biar centang biru & status online update live)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'room_reads'
  ) then
    alter publication supabase_realtime add table room_reads;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'users'
  ) then
    alter publication supabase_realtime add table users;
  end if;
end $$;
