# CareDesk Offline Sync

## What this actually does

Two independent problems, solved separately because they have different risk profiles:

1. **Reads while offline** — `client/src/lib/queryPersistence.ts` snapshots the
   React Query cache to IndexedDB and rehydrates it on boot. Zero risk: it's
   read-only, last-known-good data. A receptionist with no signal sees
   yesterday's patient list instead of a blank screen.

2. **Writes while offline** — `client/src/lib/syncEngine.ts` + an IndexedDB
   outbox (`client/src/lib/offlineDb.ts`). Every write goes through
   `useOfflineMutation`, which either sends it immediately (online) or queues
   it (offline), tagged with a client-generated `clientMutationId`.

Plus a service worker (`client/public/sw.js`) that caches the app shell
(JS/CSS/HTML) — separate from both of the above, and deliberately **does not
touch `/api/trpc`**. API caching belongs to layer 1; API queuing belongs to
layer 2. A service worker that also tried to cache/replay API calls would
duplicate both without knowing about idempotency keys or conflicts.

## Why writes needed a design, not just a queue

A naive offline queue ("store the request, replay it later") breaks in three
specific ways this app can't afford:

- **Replay duplicates.** If a queued request actually succeeded but the
  device never saw the response (dropped connection mid-round-trip), a naive
  retry creates the patient/visit/appointment/payment a second time.
  → Fixed with `clientMutationId`: every risky create/mutate now takes an
  optional UUID and checks for it first (see `patient.create`, `visit.create`,
  `appointment.create`, `bill.markAsPaid` in `server/routers.ts`). Replaying
  a successful mutation is now a safe no-op.

- **Stale conflicts.** Two devices offline at the same time can both queue a
  booking for the same slot, or both try to dispense the last units of a
  drug. Whoever syncs first should win; whoever syncs second needs a human
  decision, not a silent overwrite or a silent failure.
  → The server already had the right primitives for this (appointment
  double-booking check returns `CONFLICT`; `deductDrugStockAtomic` in
  `server/db.ts` is an atomic conditional `UPDATE ... WHERE quantity >= ?`
  that fails clean instead of going negative). `syncEngine.ts` distinguishes
  a **transient** failure (network — retry later, keep FIFO order) from a
  **real rejection** (`CONFLICT`/`BAD_REQUEST`/`FORBIDDEN` — the server saw
  it and said no) and routes the latter to `needs_review` instead of
  retrying blindly. It shows up in the Sync Issues panel (`OfflineBanner.tsx`)
  for a human to retry or discard.

- **Silent money/stock drift.** `bill.markAsPaid` applies a *delta* (adds
  `amountPaid` to a running total). Without the idempotency check, a replayed
  payment would double-charge the bill. This is why it got the same
  `clientMutationId` treatment as the creates, not just the appointments.

## What's wired end-to-end right now

All four offline-critical writes are wired through `useOfflineMutation` and
idempotent server-side:

- **Patient registration** (`Patients.tsx`) — duplicate-name/phone detection
  is a live server lookup, so it only fires on the online path. A
  registration queued offline can't pre-check this; if it turns out to be a
  dupe once it syncs, it lands in Sync Issues instead of silently merging or
  silently rejecting.
- **Visit recording** (`Visits.tsx`) — covers the drugs/labs/bill bundled
  into a visit, since dispensing and billing happen inside that one
  transaction. If the form includes prescribed drugs and the device is
  offline, it now warns the user that the on-screen stock count may be
  stale before they submit — the atomic deduct at sync time still protects
  the database from going negative, but the person dispensing should know
  the number they're looking at right now might already be wrong.
- **Appointments** (`Appointments.tsx`) — the original reference
  implementation. Online-only live double-booking confirm; a queued booking
  that conflicts at sync time lands in Sync Issues instead.
- **Payments** (`Billing.tsx`, `bill.markAsPaid`) — warns before queuing,
  since the balance shown offline may not reflect a payment collected on a
  different terminal in the meantime.

## What's *not* covered

Drug stock **display** while offline is the one open design question, not a
bug: the cached drug list a device shows offline could be stale by the time
it's used to check available quantity. The atomic deduct at sync time
protects the *database* from going negative — that part's solid — but
doesn't stop a nurse from seeing "12 in stock" when someone else already
took it to 2 on another device. The warning added to the visit form covers
this for now (tell the user, don't silently trust the number); a proper fix
would be a low-stock indicator that gets more conservative as the cached
data (`savedAt` from `queryPersistence.ts`) gets older.

All four write paths that matter offline — registering a patient, recording
a visit (with drugs and labs), booking an appointment, and recording a
payment — now go through the same queue-and-idempotency machinery. Reads
(patient list, drug list, appointment calendar, etc.) are covered generically
by the query-cache persistence layer, no per-screen work needed.

**Still required before this is trustworthy, not optional:**
1. **Run the build.** Nothing in this change has been through `tsc` or
   `vite build` — I have no `node_modules` or network access in this
   environment. `npm install --legacy-peer-deps --include=dev && npm run build`
   locally is the first real check.
2. **Apply `drizzle/0006_offline_sync.sql`** to Aiven before deploying code
   that references `clientMutationId` — the idempotency checks will error
   on a missing column otherwise. Also confirm migrations `0004`/`0005`
   (already absent from `drizzle/meta/_journal.json` before this change)
   are actually applied in production; that gap predates this work but is
   worth resolving while you're in here.
3. **Test the actual offline path on a device**, not just "does it compile":
   airplane-mode a phone, register a patient, kill and reopen the app,
   restore connectivity, confirm it appears once — not twice, not never.
   Do the same for a visit with a prescribed drug and confirm stock only
   decrements once.

## Files

| File | Purpose |
|---|---|
| `client/src/lib/offlineDb.ts` | IndexedDB wrapper: outbox + query cache stores |
| `client/src/lib/syncClient.ts` | Vanilla tRPC client for background sync (outside React) |
| `client/src/lib/syncEngine.ts` | Outbox drain loop, backoff, transient-vs-real-rejection routing |
| `client/src/lib/queryPersistence.ts` | Read-cache dehydrate/hydrate to IndexedDB |
| `client/src/hooks/useOnlineStatus.ts` | `navigator.onLine` as a hook |
| `client/src/hooks/useOutbox.ts` | Reactive outbox state for UI |
| `client/src/hooks/useOfflineMutation.ts` | Drop-in mutation hook — online-or-queue, same call site |
| `client/src/components/OfflineBanner.tsx` | Status banner + Sync Issues panel |
| `client/public/sw.js` | App-shell (static asset) caching only |
| `drizzle/0006_offline_sync.sql` | `clientMutationId` columns + unique indexes |
