-- ============================================================
-- 磁带（手记 + 纪念日）· Supabase 数据库设置（完整版）
-- 用法：Supabase 后台 → SQL Editor → New query → 粘贴全部内容 → Run
-- 可以重复运行，不会删掉已有数据。
-- ============================================================

-- 1. 数据表 ---------------------------------------------------
-- 日记、标签、日记本（以后还有纪念日）都存在同一张表里，用 store 区分种类，
-- 每条记录的内容放在 data（JSON）里。这样以后加新字段不用改表结构。
create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  store      text        not null,
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, store, id)
);

-- 允许的种类：entries 日记 / tags 标签 / notebooks 日记本 / meta 设置 / anniversaries 纪念日（筹备中）
alter table public.records drop constraint if exists records_store_check;
alter table public.records add constraint records_store_check
  check (store in ('entries', 'tags', 'notebooks', 'meta', 'anniversaries'));

-- 2. 权限：每个人只能读写自己的数据 ---------------------------
alter table public.records enable row level security;

drop policy if exists "records_select_own" on public.records;
drop policy if exists "records_insert_own" on public.records;
drop policy if exists "records_update_own" on public.records;
drop policy if exists "records_delete_own" on public.records;

create policy "records_select_own" on public.records
  for select to authenticated using (user_id = (select auth.uid()));
create policy "records_insert_own" on public.records
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "records_update_own" on public.records
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "records_delete_own" on public.records
  for delete to authenticated using (user_id = (select auth.uid()));

-- 允许“已登录用户”访问这张表（具体能读写哪些行，仍然由上面的 RLS 规则决定）
-- 较新的 Supabase 项目不会自动授权，少了这两行会报 “permission denied for table records”
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.records to authenticated;

-- 自动备份（私人仓库 A-Tape-backup 的 GitHub Actions）用 Secret key 读数据，身份是 service_role。
-- 只给“读”的权限就够了；少了这两行，备份会报 “permission denied for table records”
grant usage on schema public to service_role;
grant select on table public.records to service_role;

-- 没登录的访客什么都碰不到
revoke all on public.records from anon;

-- 3. 文件存储 -------------------------------------------------
-- photos：照片，只收 JPEG，单张最大 5MB（程序会先压缩到 1600px）
-- media ：录音，只收音频，单个最大 50MB（免费版上限）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 52428800, array[
  'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/mpeg', 'audio/mp3',
  'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/webm', 'audio/x-caf', 'audio/flac'])
on conflict (id) do update
  set public = false, file_size_limit = 52428800, allowed_mime_types = excluded.allowed_mime_types;

-- 文件按“用户ID/文件名”存放，每个人只能碰自己文件夹里的东西
drop policy if exists "photos_select_own" on storage.objects;
drop policy if exists "photos_insert_own" on storage.objects;
drop policy if exists "photos_update_own" on storage.objects;
drop policy if exists "photos_delete_own" on storage.objects;
drop policy if exists "files_select_own" on storage.objects;
drop policy if exists "files_insert_own" on storage.objects;
drop policy if exists "files_update_own" on storage.objects;
drop policy if exists "files_delete_own" on storage.objects;

create policy "files_select_own" on storage.objects
  for select to authenticated
  using (bucket_id in ('photos', 'media') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "files_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('photos', 'media') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "files_update_own" on storage.objects
  for update to authenticated
  using (bucket_id in ('photos', 'media') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "files_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id in ('photos', 'media') and (storage.foldername(name))[1] = (select auth.uid())::text);
