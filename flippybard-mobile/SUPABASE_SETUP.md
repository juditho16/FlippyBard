# Supabase Setup

1. Create a `.env` file in `flippybard-mobile` from `.env.example`.
2. Fill in for mobile (Expo):
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_SUPABASE_TABLE` (optional; default is `flappy_leaderboard`)
3. In the web project root (`FlippyBard/.env`), add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_SUPABASE_TABLE` (optional; default is `flappy_leaderboard`)
4. Ensure both apps use the same table name (`flappy_leaderboard` by default).
5. In Supabase SQL Editor, run:

```sql
create table if not exists public.flappy_leaderboard (
  name text primary key,
  score integer not null default 0 check (score >= 0),
  updated_at timestamptz not null default timezone('utc', now())
);

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

6. Restart both dev servers after adding `.env`:

```bash
# mobile
npx expo start -c

# web
npm run dev
```
