import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";
import { clearQueryCache } from "@/lib/offlineDb";
import { getOutbox, drainOutbox, setCurrentUser } from "@/lib/syncEngine";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    // A queued offline mutation needs a valid session to sync — once this
    // device logs out, any still-pending item will fail auth on its next
    // sync attempt (safely — it lands in Sync Issues rather than retrying
    // forever — but it's better to just not maim it in the first place).
    // Give a real sync attempt one last chance while we're still logged in.
    if (navigator.onLine) {
      // drainOutbox can back off for up to a minute on a flaky connection
      // (technically "online" per navigator.onLine, but requests timing
      // out) — don't let that hang the logout button. Best effort only.
      await Promise.race([drainOutbox(), new Promise((r) => setTimeout(r, 5000))]);
    }
    const stillPending = (await getOutbox()).filter((i) => i.status !== "synced");
    if (stillPending.length > 0) {
      const ok = window.confirm(
        `${stillPending.length} change${stillPending.length > 1 ? "s haven't" : " hasn't"} synced yet ` +
        `(${navigator.onLine ? "server didn't accept it — check Sync Issues" : "you're offline"}). ` +
        `Logging out now means it'll wait until someone logs back in on this device to finish syncing.\n\nLog out anyway?`
      );
      if (!ok) return;
    }
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      utils.auth.me.setData(undefined, null);
      // Wipe the ENTIRE in-memory React Query cache, not just auth.me —
      // otherwise a second staff member logging in on the same tab (common
      // on shared clinic devices, no page reload in between) sees the
      // previous user's cached patient/bill/visit data rendered instantly
      // from memory while the real refetch is still in flight. This is the
      // in-memory counterpart to clearQueryCache() below, which only wipes
      // the persisted IndexedDB snapshot.
      utils.queryClient.clear();
      // Read cache (patient names, phone numbers, medical history) shouldn't
      // linger in IndexedDB after sign-out on a shared clinic device.
      // Unsynced outbox items are deliberately left alone — see above.
      clearQueryCache();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (meQuery.data) {
      setCurrentUser({ id: meQuery.data.id, name: meQuery.data.name });
    } else if (!meQuery.isLoading) {
      setCurrentUser(null);
    }
  }, [meQuery.data, meQuery.isLoading]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
