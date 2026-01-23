-- Feature flags per user

create table if not exists public.user_feature_flags (
  user_id uuid not null references auth.users(id) on delete cascade,
  flag_key text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, flag_key)
);

alter table public.user_feature_flags enable row level security;

-- Users can read their own flags
create policy "Users can read their own feature flags"
on public.user_feature_flags
for select
to authenticated
using (auth.uid() = user_id);

-- Users can insert/update their own flags
create policy "Users can upsert their own feature flags"
on public.user_feature_flags
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own feature flags"
on public.user_feature_flags
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Optional: users can delete their own flag overrides
create policy "Users can delete their own feature flags"
on public.user_feature_flags
for delete
to authenticated
using (auth.uid() = user_id);

-- Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_feature_flags_updated_at on public.user_feature_flags;
create trigger set_user_feature_flags_updated_at
before update on public.user_feature_flags
for each row execute function public.set_updated_at();
