import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { toast } from "sonner";
import { parseTierError } from "@shared/tiers";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Use in a mutation's onError instead of `toast.error(e.message)` directly.
 * main.tsx's global mutation-cache subscriber already shows a friendly,
 * translated toast (with an Upgrade action button) for any TIER_LIMIT_*
 * error — that fires independently of a mutation's own onError, so calling
 * toast.error(e.message) here too would show a second, raw toast reading
 * something like "TIER_LIMIT_STAFF:1:free" right on top of the friendly
 * one. This only suppresses that specific duplicate; every other error
 * still surfaces normally.
 */
export function mutationErrorToast(e: { message: string }) {
  if (parseTierError(e.message)) return;
  toast.error(e.message);
}
