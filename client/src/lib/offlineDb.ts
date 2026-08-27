/**
 * Thin native-IndexedDB wrapper. No external dependency on purpose — this
 * runs inside a service-worker-adjacent context on low-end Android phones
 * over Termux-deployed builds, and every extra KB of JS is something a
 * receptionist's phone has to parse before the app is usable.
 *
 * Two object stores:
 *  - `outbox`   — mutations made while offline, waiting to sync
 *  - `queryCache` — a single dehydrated React Query cache snapshot, so
 *    screens have something to show before the first network round-trip
 *    completes (or when there's no network at all)
 */

const DB_NAME = "caredesk-offline";
const DB_VERSION = 1;
export const OUTBOX_STORE = "outbox";
export const QUERY_CACHE_STORE = "queryCache";

export type OutboxStatus = "pending" | "syncing" | "needs_review" | "synced";

export interface OutboxItem {
  /** Also doubles as the clientMutationId sent to the server for idempotency. */
  id: string;
  /** Dotted tRPC procedure path, e.g. "appointment.create" */
  procedure: string;
  input: Record<string, unknown>;
  status: OutboxStatus;
  createdAt: number;
  attempts: number;
  lastError?: string;
  /** Human-readable summary shown in the Sync Issues panel, e.g. "Book: Jane M — 18 Jul, 2:00pm" */
  label: string;
  /**
   * Who was logged in when this was queued. Shared clinic devices mean a
   * different staff member can log in before this syncs — the write itself
   * stays correct (idempotency keys prevent duplicates), but syncing it
   * under whoever happens to be logged in at drain time would misattribute
   * it in the activity log. The sync engine only auto-syncs items whose
   * queuedByUserId matches the currently authenticated user.
   */
  queuedByUserId: number;
  queuedByUserName: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available in this environment"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const store = db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
        store.createIndex("status", "status");
        store.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains(QUERY_CACHE_STORE)) {
        db.createObjectStore(QUERY_CACHE_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Outbox ──────────────────────────────────────────────────────────────

export async function outboxPut(item: OutboxItem): Promise<void> {
  await withStore(OUTBOX_STORE, "readwrite", (store) => store.put(item));
}

export async function outboxGetAll(): Promise<OutboxItem[]> {
  return withStore(OUTBOX_STORE, "readonly", (store) => store.getAll());
}

export async function outboxDelete(id: string): Promise<void> {
  await withStore(OUTBOX_STORE, "readwrite", (store) => store.delete(id));
}

export async function outboxClearSynced(): Promise<void> {
  const all = await outboxGetAll();
  const db = await openDb();
  const tx = db.transaction(OUTBOX_STORE, "readwrite");
  const store = tx.objectStore(OUTBOX_STORE);
  for (const item of all) {
    if (item.status === "synced") store.delete(item.id);
  }
}

// ── Query cache (for offline reads) ────────────────────────────────────

export async function saveQueryCache(snapshot: unknown): Promise<void> {
  await withStore(QUERY_CACHE_STORE, "readwrite", (store) =>
    store.put({ key: "snapshot", data: snapshot, savedAt: Date.now() })
  );
}

/**
 * Called on logout. Clears the *read* cache only — cached patient names,
 * phone numbers, medical history shouldn't sit in IndexedDB indefinitely on
 * a shared clinic device after someone signs out.
 *
 * Deliberately does NOT touch the outbox. A queued patient registration or
 * visit made while offline is real unsynced work — wiping it on logout
 * would silently lose it, which is worse than the privacy problem this is
 * meant to fix. It stays queued and syncs (idempotently) once someone is
 * authenticated and online again, whether that's the same person logging
 * back in or a colleague on the same device.
 */
export async function clearQueryCache(): Promise<void> {
  await withStore(QUERY_CACHE_STORE, "readwrite", (store) => store.delete("snapshot"));
}

export async function loadQueryCache(): Promise<{ data: unknown; savedAt: number } | undefined> {
  const result = await withStore<any>(QUERY_CACHE_STORE, "readonly", (store) => store.get("snapshot"));
  return result ? { data: result.data, savedAt: result.savedAt } : undefined;
}
