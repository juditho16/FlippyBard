# Supabase Setup

1. Create a project-root `.env` from `.env.example`.
2. Fill in:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_SUPABASE_TABLE` (optional, defaults to `flappy_leaderboard`)
3. In the Supabase SQL Editor, run this schema setup:

```sql
create table if not exists public.flappy_leaderboard (
  name text primary key,
  score integer not null default 0 check (score >= 0),
  coins integer not null default 0 check (coins >= 0),
  extra_lives integer not null default 0 check (extra_lives >= 0),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.flappy_leaderboard
  add column if not exists coins integer not null default 0,
  add column if not exists extra_lives integer not null default 0;

alter table public.flappy_leaderboard enable row level security;

drop policy if exists "flappy_leaderboard_select_all" on public.flappy_leaderboard;
create policy "flappy_leaderboard_select_all"
on public.flappy_leaderboard
for select
using (true);

drop policy if exists "flappy_leaderboard_insert_all" on public.flappy_leaderboard;
create policy "flappy_leaderboard_insert_all"
on public.flappy_leaderboard
for insert
with check (true);

drop policy if exists "flappy_leaderboard_update_all" on public.flappy_leaderboard;
create policy "flappy_leaderboard_update_all"
on public.flappy_leaderboard
for update
using (true)
with check (true);
```

4. If you already created the old table with only `name`, `score`, and `updated_at`, the `alter table ... add column if not exists ...` lines above are the part that adds `coins` and `extra_lives` without deleting existing rows.
5. Restart Expo after editing `.env`:

```bash
npx expo start -c
```

6. After that, each player row in `flappy_leaderboard` should contain:
   - `name`
   - `score`
   - `coins`
   - `extra_lives`
   - `updated_at`
