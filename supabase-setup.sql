-- Note PWA — Supabase setup
-- 1) Create a new Supabase project (separate from Habit)
-- 2) Authentication -> Providers -> Anonymous -> Enable
-- 3) Run this SQL in SQL Editor

create table if not exists public.note_categories (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.note_entries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.note_categories(id) on delete set null,
  title text,
  body text not null default '',
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  deleted_at timestamptz
);

create index if not exists note_categories_user_sort_idx
  on public.note_categories (user_id, sort_order);

create index if not exists note_entries_user_updated_idx
  on public.note_entries (user_id, updated_at desc);

create index if not exists note_entries_user_category_updated_idx
  on public.note_entries (user_id, category_id, updated_at desc);

alter table public.note_categories enable row level security;
alter table public.note_entries enable row level security;

drop policy if exists "note_categories_select_own" on public.note_categories;
create policy "note_categories_select_own"
on public.note_categories for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "note_categories_insert_own" on public.note_categories;
create policy "note_categories_insert_own"
on public.note_categories for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "note_categories_update_own" on public.note_categories;
create policy "note_categories_update_own"
on public.note_categories for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "note_categories_delete_own" on public.note_categories;
create policy "note_categories_delete_own"
on public.note_categories for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists "note_entries_select_own" on public.note_entries;
create policy "note_entries_select_own"
on public.note_entries for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "note_entries_insert_own" on public.note_entries;
create policy "note_entries_insert_own"
on public.note_entries for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "note_entries_update_own" on public.note_entries;
create policy "note_entries_update_own"
on public.note_entries for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "note_entries_delete_own" on public.note_entries;
create policy "note_entries_delete_own"
on public.note_entries for delete to authenticated
using (auth.uid() = user_id);
