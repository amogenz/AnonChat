-- ============================================================
-- AnonChat — migrasi v4: centang terkirim & dibaca
-- Jalankan di Supabase Dashboard > SQL Editor > New Query > Run
-- ============================================================

-- 1) Kolom penanda (array user id)
alter table messages add column if not exists delivered_to uuid[] not null default '{}';
alter table messages add column if not exists read_by uuid[] not null default '{}';
create index if not exists messages_sender_idx on messages (sender_id, created_at desc);

-- 2) Fungsi atomik penanda (hindari lost-update antar client)
create or replace function mark_msg(p_mid uuid, p_uid uuid, p_kind text)
returns void
language plpgsql
security definer
as $$
begin
  if p_kind = 'delivered' then
    update messages
    set delivered_to = (select coalesce(array_agg(distinct x), '{}') from unnest(delivered_to || p_uid) as x)
    where id = p_mid;
  elsif p_kind = 'read' then
    update messages
    set read_by = (select coalesce(array_agg(distinct x), '{}') from unnest(read_by || p_uid) as x)
    where id = p_mid;
  end if;
end;
$$;

-- 3) Izinkan anon memanggil fungsi (konsisten dgn policy "open")
grant execute on function mark_msg(uuid, uuid, text) to anon;
grant execute on function mark_msg(uuid, uuid, text) to authenticated;

-- 4) Pastikan event UPDATE ikut realtime (butuh replica identity;
--    tabel messages punya PK jadi default-nya sudah cukup)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
