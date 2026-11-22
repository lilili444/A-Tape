-- ============================================================
-- 纸页日记 · Supabase 数据库设置
-- 用法：Supabase 后台 → SQL Editor → New query → 粘贴全部内容 → Run
-- 可以重复运行，不会删掉已有数据。
-- ============================================================

-- 1. 数据表 ---------------------------------------------------
-- 日记、标签、日记本都存在同一张表里，用 store 区分种类，
-- 每条记录的内容放在 data（JSON）里。这样以后加新字段不用改表结构。
create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  store      text        not null check (store in ('entries', 'tags', 'notebooks', 'meta')),
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, store, id)
);

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

-- 没登录的访客什么都碰不到
revoke all on public.records from anon;

-- 3. 照片存储 -------------------------------------------------
-- 私有的存储桶：照片按“用户ID/照片ID.jpg”存放，单张最大 5MB，只收 JPEG。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

drop policy if exists "photos_select_own" on storage.objects;
drop policy if exists "photos_insert_own" on storage.objects;
drop policy if exists "photos_update_own" on storage.objects;
drop policy if exists "photos_delete_own" on storage.objects;

create policy "photos_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
