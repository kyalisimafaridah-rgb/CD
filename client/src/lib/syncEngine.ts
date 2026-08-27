import { outboxGetAll, outboxPut, outboxDelete, type OutboxItem } from "./offlineDb";
import { resolveProcedure, isTransientError } from "./syncClient";
import { trpc } from "./trpc";
import { getQueryKey } from "@trpc/react-query";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Drains the offline outbox one item at a time, in the order they were
 * created. FIFO matters: a visit created offline must sync before a
 * payment against that visit's bill does, or the payment sync will fail
 * with "bill not found".
 *
 * Three outcomes per item:
 *  - success            → remove from outbox, invalidate affected queries
 *  - transient failure   (network still down, request never reached server)
 *                        → leave pending, stop draining (preserve order), retry later
 *  - real rejection      (CONFLICT, BAD_REQUEST, FORBIDDEN — the server saw
 *                        it and said no, e.g. double-booked slot or
 *                        insufficient drug stock) → mark `needs_review` and
 *                        move on to the next item. This is never silently
 *                        retried or discarded — a human has to look at it,
 *                        because it means something changed on the server
 *                        between when this was queued and when it synced.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
let queryClientRef: QueryClient | null = null;
let draining = false;
let backoffMs = 2000;
const MAX_BACKOFF_MS = 60_000;

let currentUser: { id: number; name: string } | null = null;

/**
 * Called from useAuth whenever the session changes (login, logout, or the
 * initial auth.me load). Needed here — not just in components — because
 * the outbox drains from background triggers (online event, interval,
 * app boot) that never render a component.
 */
export function setCurrentUser(user: { id: number; name: string } | null) {
  currentUser = user;
}

export function initSyncEngine(queryClient: QueryClient) {
  queryClientRef = queryClient;
  window.addEventListener("online", () => drainOutbox());
  // Periodic sweep in case the browser's 'online' event was missed (common
  // on flaky mobile data — you get signal back without a clean transition).
  setInterval(() => {
    if (navigator.onLine) drainOutbox();
  }, 30_000);
  if (navigator.onLine) drainOutbox();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((l) => l());
}

export async function enqueue(procedure: string, input: Record<string, unknown>, label: string): Promise<string> {
  // Reuse the clientMutationId already on the input if one was set by an
  // online attempt that failed transiently — that id may have already
  // reached the server (dropped connection mid-round-trip). Minting a new
  // one here would let the replay create a duplicate record, defeating the
  // entire reason clientMutationId exists. Only generate fresh when this is
  // a genuinely new item (the pure-offline path, which never made a
  // network attempt under any id).
  const id = typeof input.clientMutationId === "string" ? input.clientMutationId : crypto.randomUUID();
  const item: OutboxItem = {
    id,
    procedure,
    input: { ...input, clientMutationId: id },
    status: "pending",
    createdAt: Date.now(),
    attempts: 0,
    label,
    queuedByUserId: currentUser?.id ?? 0,
    queuedByUserName: currentUser?.name ?? "Unknown user",
  };
  await outboxPut(item);
  notify();
  if (navigator.onLine) drainOutbox();
  return id;
}

export async function getOutbox() {
  const items = await outboxGetAll();
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function retryItem(id: string) {
  const items = await outboxGetAll();
  const item = items.find((i) => i.id === id);
  if (!item) return;
  await outboxPut({ ...item, status: "pending", lastError: undefined });
  notify();
  drainOutbox();
}

export async function discardItem(id: string) {
  await outboxDelete(id);
  notify();
}

/**
 * Maps a synced procedure to the queries that should refetch after it
 * succeeds. Built with `getQueryKey` rather than hand-written key arrays —
 * @trpc/react-query nests its cache keys as `[[...path], { input, type }]`,
 * not the flat `["visit", "list"]` shape it might look like from the
 * outside. A hand-guessed key silently matches nothing: invalidateQueries
 * just no-ops instead of erroring, so the bug is a stale screen after a
 * background sync, not a crash — the kind of thing that's easy to ship
 * without noticing.
 */
function invalidationsFor(procedure: string): unknown[][] {
  const [entity] = procedure.split(".");
  const map: Record<string, unknown[][]> = {
    patient: [getQueryKey(trpc.patient.list), getQueryKey(trpc.clinic.getTierStatus)],
    visit: [
      getQueryKey(trpc.visit.list),
      getQueryKey(trpc.patient.list),
      getQueryKey(trpc.drug.list),
      getQueryKey(trpc.bill.list),
      getQueryKey(trpc.clinic.getTierStatus),
    ],
    appointment: [getQueryKey(trpc.appointment.list), getQueryKey(trpc.appointment.today)],
    bill: [getQueryKey(trpc.bill.list), getQueryKey(trpc.patient.getDebtors)],
  };
  return map[entity] ?? [];
}

export async function drainOutbox(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (navigator.onLine) {
      const items = await getOutbox();
      const next = items.find((i) => i.status === "pending");
      if (!next) break;

      if (currentUser && next.queuedByUserId !== currentUser.id) {
        // Belongs to someone else who isn't currently signed in on this
        // device. Leave it exactly as-is — don't skip ahead to later items
        // either, since FIFO order can matter (a visit must sync before a
        // payment against its bill). It'll drain automatically once that
        // person signs back in and setCurrentUser reflects them, or a
        // manager can review it in Sync Issues.
        notify();
        break;
      }

      await outboxPut({ ...next, status: "syncing" });
      notify();

      try {
        const proc = resolveProcedure(next.procedure);
        await proc.mutate(next.input);
        await outboxDelete(next.id);
        backoffMs = 2000; // reset backoff on success
        for (const key of invalidationsFor(next.procedure)) {
          queryClientRef?.invalidateQueries({ queryKey: key });
        }
        notify();
      } catch (err) {
        if (isTransientError(err)) {
          // Still offline in practice, or the server is unreachable — put it
          // back to pending and stop for now so order is preserved for the
          // next drain pass.
          await outboxPut({ ...next, status: "pending", attempts: next.attempts + 1, lastError: "Connection issue — will retry" });
          notify();
          await new Promise((r) => setTimeout(r, backoffMs));
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
          break;
        } else {
          // The server actively rejected this — e.g. the appointment slot
          // got taken, or stock ran out, in the time between queuing and
          // syncing. Needs a human decision, not a silent retry/overwrite.
          const message = (err as { message?: string })?.message ?? "Sync failed — needs review";
          await outboxPut({ ...next, status: "needs_review", attempts: next.attempts + 1, lastError: message });
          notify();
        }
      }
    }
  } finally {
    draining = false;
  }
}
