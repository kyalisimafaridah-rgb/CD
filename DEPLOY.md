# CareDesk — Deploy on Render + Supabase (Postgres)

## 1. Supabase database

1. Create a project at https://supabase.com
2. **Project Settings → Database**
   - Copy the **URI** connection string
   - For the **running app on Render**, use the **Transaction pooler** (port `6543`)
   - For **local migrations**, use the **direct** connection (port `5432`)
3. Password is the one you set when creating the project

## 2. Apply schema

Locally (with Node 20+):

```bash
pnpm install
# Direct connection string (port 5432), not the pooler:
export DATABASE_URL="postgresql://postgres.[ref]:[YOUR-PASSWORD]@aws-0-....supabase.com:5432/postgres"
pnpm db:push
# or: pnpm db:generate && pnpm db:migrate
```

`db:push` creates enums + tables in one step on an empty project.

## 3. Render web service

1. Push this repo to GitHub
2. Render → **New → Web Service** → connect the repo
3. Settings:

| Field | Value |
|--------|--------|
| Runtime | Node |
| Build Command | `pnpm install && pnpm run build` |
| Start Command | `pnpm start` |
| Plan | Free or Starter |

4. **Environment variables**

```
DATABASE_URL=postgresql://postgres.[ref]:[password]@....pooler.supabase.com:6543/postgres
JWT_SECRET=<openssl rand -base64 48>
APP_URL=https://YOUR-SERVICE.onrender.com
NODE_ENV=production

# Optional
AT_USERNAME=
AT_API_KEY=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
```

5. Deploy. Open `APP_URL`, register a clinic, sign in.

## 4. Notes

- CareDesk uses **its own auth** (email/password + phone OTP). Supabase Auth is not required.
- `prepare: false` is set on the Postgres client so the **Supabase pooler (PgBouncer)** works.
- SSL is required (`ssl: "require"`).
- Old MySQL migrations under `drizzle/*.sql` are historical; after switching to Postgres, use `db:push` or generate fresh migrations with `db:generate`.

## 5. Rollback

MySQL schema backup: `drizzle/schema.mysql.bak.ts`  
To go back you would restore that file, switch `package.json` to `mysql2`, and point `DATABASE_URL` at MySQL again.


## Post-migration fixes (already applied in this build)

- All `insert` + ID paths use Postgres `.returning({ id })`
- Unique violations handle SQLSTATE `23505`
- Appointment overlap uses `make_interval` (not MySQL `DATE_ADD`)
- Update row counts use `rowCount` (not MySQL `affectedRows`)
- Bill columns match app code: `labTotal`, `drugTotal`, `balanceAmount`, `dueDate`, `paidDate`
- Driver: `postgres` (postgres.js) with `ssl: "require"` and `prepare: false` for Supabase pooler

## Smoke test after deploy

1. Open `APP_URL` → Register a clinic
2. Sign in → Dashboard loads
3. Register a patient
4. Start a visit → complete → bill appears
5. Record a payment → balance updates
6. Add a medicine → stock shows
7. Book an appointment

## MTN MoMo activation codes
1. After deploy, run `pnpm db:push` so `activationCodes` table exists.
2. Admin (Owner Dashboard) generates codes after confirming MoMo payment.
3. Clinic manager redeems under Settings → Subscription.


## Self-service MTN MoMo (payment requests)

1. Clinic: Settings → choose plan → submit payment request (WhatsApp as MoMo reason).
2. Admin: Owner Dashboard → amber **Pending payments** → **Approve & activate** (instant, no code).
3. Fallback: still generate activation codes if needed.
4. After deploy: `pnpm db:push` to create `subscriptionPaymentRequests`.

Full automation later: MTN MoMo Collections (request-to-pay) + webhook can call the same approve path with no admin click.
