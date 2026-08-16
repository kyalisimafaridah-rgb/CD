import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import { hydrateFromDisk, startPersisting } from "@/lib/queryPersistence";
import { initSyncEngine } from "@/lib/syncEngine";
import { parseTierError } from "@shared/tiers";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // tRPC errors carry an HTTP-style code. Codes like UNAUTHORIZED, FORBIDDEN,
      // BAD_REQUEST, NOT_FOUND, and CONFLICT are deterministic — retrying without
      // the underlying condition changing (e.g. re-logging in, upgrading a plan)
      // will just fail again. Retrying them wastes requests and, worse, re-fires
      // this file's error-cache subscribers (toasts, the redirect above) once per
      // retry instead of once per logical error. Only retry on errors that might
      // plausibly be transient (network blips, 5xx, timeouts).
      retry: (failureCount, error) => {
        if (error instanceof TRPCClientError) {
          const code = (error.data as { code?: string } | undefined)?.code;
          const nonRetryableCodes = new Set([
            "UNAUTHORIZED", "FORBIDDEN", "BAD_REQUEST", "NOT_FOUND", "CONFLICT",
          ]);
          if (code && nonRetryableCodes.has(code)) return false;
        }
        return failureCount < 2;
      },
    },
  },
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;
  if (!isUnauthorized) return;

  // Avoid clobbering an in-flight navigation if we're already on the login page
  // (e.g. a stray query error firing right after ProtectedRoute already redirected).
  if (window.location.pathname === getLoginUrl()) return;

  // Preserve where the user was headed — this fires far more often in practice
  // than ProtectedRoute's own redirect, since it catches session expiry on an
  // already-mounted page (e.g. a background refetch failing after the JWT's
  // sessionVersion no longer matches), not just direct navigation while logged out.
  const redirectTarget = window.location.pathname + window.location.search;
  window.location.href = `${getLoginUrl()}?redirect=${encodeURIComponent(redirectTarget)}`;
};

/**
 * Parse a TIER_LIMIT error message and return a human-readable upgrade prompt.
 * See shared/tiers.ts for the actual implementation — extracted there so
 * useOfflineMutation (which bypasses react-query's mutation cache entirely)
 * can use the same translation instead of silently missing it.
 */

const handleGlobalError = (error: unknown) => {
  redirectToLoginIfUnauthorized(error);
  if (error instanceof TRPCClientError) {
    const tierMsg = parseTierError(error.message);
    if (tierMsg) {
      // Dynamically import toast to avoid circular deps
      import("sonner").then(({ toast }) => {
        toast.error(tierMsg, {
          duration: 8000,
          action: {
            label: "Upgrade",
            onClick: () => { window.location.href = "/settings"; },
          },
        });
      });
    }
  }
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    handleGlobalError(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    handleGlobalError(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

// Offline app shell — cache-first static assets so CareDesk opens with no signal.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[Offline] Service worker registration failed", err);
    });
  });
}

// Outbox drain: replays queued mutations (patient/visit/appointment/payment
// creates made while offline) as soon as connectivity returns.
initSyncEngine(queryClient);

// Persist the query cache to IndexedDB so screens show last-known data
// instead of a blank page when opened with no connectivity.
startPersisting(queryClient);

async function boot() {
  // Hydrate from disk before the first render where possible. This is a
  // best-effort attempt with a short budget — we don't want a slow
  // IndexedDB read to delay first paint when the network is fine.
  await Promise.race([hydrateFromDisk(queryClient), new Promise((r) => setTimeout(r, 150))]);

  createRoot(document.getElementById("root")!).render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

boot();
