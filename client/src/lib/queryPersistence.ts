import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";
import { saveQueryCache, loadQueryCache } from "./offlineDb";

const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // stale cache older than a week isn't worth trusting

/**
 * On boot, before the app renders real data, hydrate the query client from
 * whatever was last saved to IndexedDB. This is what lets a receptionist
 * open the app with zero signal and still see yesterday's patient list
 * instead of a blank screen — it's last-known-good, not live, and screens
 * should treat it that way (the `isOnline` flag from useOnlineStatus tells
 * them which one they're looking at).
 */
export async function hydrateFromDisk(queryClient: QueryClient): Promise<void> {
  try {
    const cached = await loadQueryCache();
    if (!cached) return;
    if (Date.now() - cached.savedAt > MAX_CACHE_AGE_MS) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hydrate(queryClient, cached.data as any);
  } catch {
    // Corrupt or unavailable cache shouldn't block the app from starting.
  }
}

/**
 * Periodically snapshot the query cache to IndexedDB. Debounced via a
 * simple timer rather than on every single query update, since dehydrate()
 * on a large cache isn't free and this doesn't need to be real-time.
 */
export function startPersisting(queryClient: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const persistNow = () => {
    try {
      const snapshot = dehydrate(queryClient, {
        // Only persist successful queries — pending/error states aren't useful offline.
        shouldDehydrateQuery: (query) => query.state.status === "success",
      });
      saveQueryCache(snapshot);
    } catch {
      // Best-effort; a failed snapshot just means we fall back to network next launch.
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(persistNow, 3000);
  };

  const unsubscribe = queryClient.getQueryCache().subscribe(schedule);
  window.addEventListener("beforeunload", persistNow);

  return () => {
    unsubscribe();
    window.removeEventListener("beforeunload", persistNow);
    if (timer) clearTimeout(timer);
  };
}
