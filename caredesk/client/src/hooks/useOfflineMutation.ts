import { useState, useCallback } from "react";
import { useOnlineStatus } from "./useOnlineStatus";
import { enqueue } from "@/lib/syncEngine";
import { resolveProcedure, isTransientError } from "@/lib/syncClient";
import { parseTierError } from "@shared/tiers";

interface OfflineMutationOptions {
  /** Dotted tRPC procedure path, e.g. "appointment.create" */
  procedure: string;
  /** Builds the human-readable outbox label from the input, e.g. (i) => `Book: ${i.patientName}` */
  label: (input: Record<string, unknown>) => string;
}

interface Result {
  queued: boolean;
  data?: unknown;
}

/**
 * Drop-in replacement for `trpc.x.y.useMutation()` for the offline-critical
 * writes (patient/visit/appointment create, payment recording). Same call
 * shape either way — the caller doesn't need an if/else for online vs
 * offline, which is what makes this safe to apply consistently instead of
 * ad-hoc per screen.
 *
 * - Online + succeeds → behaves exactly like a normal mutation.
 * - Online + request fails to even reach the server (dropped connection
 *   mid-tap, which is common on Termux/Android over patchy data) → falls
 *   back to queuing instead of showing an error.
 * - Offline → queues immediately, returns { queued: true } so the UI can
 *   show "Saved — will sync" instead of the normal success state.
 *
 * Every mutation is tagged with a client-generated UUID (clientMutationId)
 * so if the queue replays it later, the server recognizes the retry and
 * doesn't create a duplicate record.
 */
export function useOfflineMutation({ procedure, label }: OfflineMutationOptions) {
  const isOnline = useOnlineStatus();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (input: Record<string, unknown>): Promise<Result> => {
      setIsPending(true);
      setError(null);
      const clientMutationId = crypto.randomUUID();
      const payload = { ...input, clientMutationId };

      if (isOnline) {
        try {
          const data = await resolveProcedure(procedure).mutate(payload);
          setIsPending(false);
          return { queued: false, data };
        } catch (err) {
          if (isTransientError(err)) {
            await enqueue(procedure, payload, label(input));
            setIsPending(false);
            return { queued: true };
          }
          setIsPending(false);
          const rawMessage = (err as { message?: string })?.message ?? "Something went wrong";
          const tierMsg = parseTierError(rawMessage);
          if (tierMsg) {
            const { toast } = await import("sonner");
            toast.error(tierMsg, {
              duration: 8000,
              action: { label: "Upgrade", onClick: () => { window.location.href = "/settings"; } },
            });
            setError(tierMsg);
            // Re-throw so the caller's own catch doesn't also show a second,
            // redundant "Failed to..." toast on top of this one — callers
            // check for this by re-checking parseTierError themselves, or
            // simply don't need to show anything further since this already did.
            throw err;
          }
          setError(rawMessage);
          throw err;
        }
      }

      await enqueue(procedure, payload, label(input));
      setIsPending(false);
      return { queued: true };
    },
    [isOnline, procedure, label]
  );

  return { mutate, isPending, error, isOnline };
}
