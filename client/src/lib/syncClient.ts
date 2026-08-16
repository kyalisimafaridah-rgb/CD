import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";

/**
 * A second, plain (non-React-hooks) tRPC client that the sync engine uses
 * to replay queued mutations. It's separate from the `trpc.Provider` client
 * in main.tsx because the outbox drains in the background — on an `online`
 * event, on an interval, on app boot — not from inside a component render.
 */
export const syncClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
      },
    }),
  ],
});

/** Resolve a dotted procedure path like "appointment.create" against the client proxy. */
export function resolveProcedure(path: string): { mutate: (input: unknown) => Promise<unknown> } {
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = syncClient;
  for (const part of parts) node = node[part];
  return node;
}

/** True for connectivity failures worth retrying later; false for real server rejections. */
export function isTransientError(err: unknown): boolean {
  if (err instanceof TRPCClientError) {
    // A response came back from the server — it's a real rejection
    // (validation, CONFLICT, FORBIDDEN, etc), not a network problem.
    if (err.data) return false;
    return true; // no `.data` usually means the request never reached the server
  }
  if (typeof err === "object" && err !== null && "message" in err) {
    const msg = String((err as { message: unknown }).message).toLowerCase();
    return msg.includes("fetch") || msg.includes("network") || msg.includes("failed to fetch");
  }
  return true;
}
