# Database setup

The app needs **PostgreSQL**. Without a connection string it still runs, but
everything is held in memory and is lost the moment the server restarts.

You do **not** create any tables by hand. Every store runs
`CREATE TABLE IF NOT EXISTS` on boot. You create an empty database, paste the
connection string into `.env`, and start the app.

---

## What you need

**Two databases, not one.**

| Database | Used by | Why separate |
|---|---|---|
| App | `npm run dev` | Your real records |
| Test | `npm run test:db` | The durability tests **delete every row** after each test. Pointed at the app database, they would wipe it. |

---

## Option A — Supabase (recommended)

Matches what the project docs already assume, and gives you backups and a
browser SQL editor.

1. Go to <https://supabase.com> and sign in.
2. **New project**. Choose a name, set a database password (save it), and pick a
   region close to your users — `ap-south-1 (Mumbai)` for India.
3. Wait ~2 minutes for it to provision.
4. **Project Settings → Database → Connection string → URI**.
5. You will see two. Take the **Transaction pooler** one, on port **6543**:

```
postgresql://postgres.abcdefghijkl:YOUR-PASSWORD@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
```

6. Replace `YOUR-PASSWORD` with the password from step 2, and add
   `?pgbouncer=true` at the end.

> **Use port 6543, not 5432.** 6543 is the pooler. The free tier runs out of
> direct connections quickly, and the app's code works correctly with
> transaction-mode pooling because it uses simple queries throughout.

For the **test** database, repeat steps 1–6 as a second Supabase project.

---

## Option B — Local Postgres with Docker

Free, fast, nothing leaves your machine. Good for development.

```bash
docker run --name n1-oms-db \
  -e POSTGRES_PASSWORD=localdev \
  -e POSTGRES_DB=n1oms \
  -p 5432:5432 \
  -d postgres:16

docker exec -it n1-oms-db psql -U postgres -c "CREATE DATABASE n1oms_test;"
```

Connection strings:

```
postgresql://postgres:localdev@localhost:5432/n1oms
postgresql://postgres:localdev@localhost:5432/n1oms_test
```

SSL is skipped automatically for `localhost`.

To start it again after a reboot: `docker start n1-oms-db`.

---

## Putting it in `.env`

Edit `.env` in the project root:

```bash
DATABASE_URL=postgresql://...        # the app database
```

Then restart `npm run dev`. The tables are created on first boot.

---

## The tables it creates

You never write these. They appear automatically.

| Table | Holds |
|---|---|
| `orga_nodes` | **Every record** — employees, leave, tasks, courses, everything. One `type` column plus a JSONB `data` column, which is why a new record type never needs a migration. |
| `orga_edges` | Relationships between records — who reports to whom, who owns what |
| `orga_activity` | The audit log — every action, who did it, under what authority |
| `orga_figures` | Computed numbers and the parts they were calculated from |
| `orga_accounts` | Logins |
| `orga_autonomy_rules` | Standing-rule state |
| `orga_activity_seq` | A sequence, so audit ids never repeat across restarts |

Phase 1 adds `orga_notifications`, `orga_day_plans`, `orga_streaks` and
`orga_estimate_learning` the same way.

---

## The first login

On an **empty** database with `ORG_SEED_DEMO=false`, no accounts exist yet. The
app creates exactly one, from `.env`:

```bash
ORG_BOOTSTRAP_USER=admin
ORG_BOOTSTRAP_PASSWORD=pick-something-temporary
```

Sign in with those once. The app immediately forces you to set a real password
before it will let you anywhere else — the value in `.env` stops working at that
point. Everyone else is then added inside the platform.

With `ORG_SEED_DEMO=true` (the default in development) you instead get the nine
demo people and their logins, listed on the sign-in page.

---

## Verifying it worked

```bash
npm run dev
```

Then:

1. Sign in.
2. Create something — a task will do.
3. Stop the server (`Ctrl+C`) and start it again.
4. The task is still there.

If it vanished, `DATABASE_URL` is not being read — check for typos and that
`.env` is in the project root.

To run the durability tests against your **test** database:

```bash
DATABASE_URL=<test-database-url> npm run test:db
```

Without a `DATABASE_URL` those tests report as skipped rather than failing.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Data disappears on restart | `DATABASE_URL` unset or misspelt — the app silently fell back to in-memory |
| `password authentication failed` | The password in the string still says `YOUR-PASSWORD`, or contains characters needing URL-encoding (`@` → `%40`, `#` → `%23`) |
| `too many connections` | You used port 5432 on Supabase. Switch to the pooler on 6543 |
| `self signed certificate` | Non-local hosts get SSL automatically; if you tunnel through localhost, use a local connection string |
| Your real data got deleted | `npm run test:db` was pointed at the app database. Use a separate one |

---

## Security

- `.env` is gitignored (`.env*`), so it is never committed. Keep it that way.
- Rotate the database password if it was ever pasted into a chat, a terminal
  recording, or a shared document. `docs/HANDOFF.md` notes one such incident.
- The `ORG_BOOTSTRAP_PASSWORD` is single-use by design — replace it at first
  login and it stops working.
- Consider adding a committed `.env.example` (with a `!.env.example` line in
  `.gitignore`) listing the variable names but no values, so the next person
  does not have to guess.
