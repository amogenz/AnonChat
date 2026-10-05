-- ============================================================
-- AnonChat — migrasi v5: gambar "dilihat sekali" (view-once)
-- Jalankan SETELAH migrasi v4 (supabase-migration-03.sql)
-- di Supabase Dashboard > SQL Editor > New Query > Run
-- ============================================================

-- 1) Kolom baru di messages
alter table messages add column if not exists kind text not null default 'text';
alter table messages add column if not exists media text;  -- base64 JPEG (FHD), hanya utk kind='image'
alter table messages add column if not exists viewed_by uuid[] not null default '{}';

-- batasi kind yang valid
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_kind_check') then
    alter table messages add constraint messages_kind_check check (kind in ('text', 'image'));
  end if;
end $$;

create index if not exists messages_kind_idx on messages (room_id, kind, created_at desc);

-- 2) Perluas fungsi mark_msg: tambah kind 'viewed'
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
  elsif p_kind = 'viewed' then
    update messages
    set viewed_by = (select coalesce(array_agg(distinct x), '{}') from unnest(viewed_by || p_uid) as x)
    where id = p_mid;
  end if;
end;
$$;

grant execute on function mark_msg(uuid, uuid, text) to anon;
grant execute on function mark_msg(uuid, uuid, text) to authenticated;
