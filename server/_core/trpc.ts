import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG, SUBSCRIPTION_SUSPENDED_ERR_MSG, TRIAL_EXPIRED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { getClinicAccessStatus } from "../subscription";
import { ENV } from "./env";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Without this, any *unexpected* exception (a DB connection drop, a
    // driver error, anything not deliberately thrown as a TRPCError with a
    // hand-written message) passes its raw .message straight through to the
    // client untouched — including full SQL text, bound parameter values,
    // and column names. That's exactly what showed up on a live device:
    // "Failed query: select `id`, `clinicId`, ... for update params:
    // 3,INV-202607-%,1" rendered directly on a nurse's screen mid-visit.
    //
    // Deliberately-thrown TRPCErrors (FORBIDDEN/BAD_REQUEST/CONFLICT/etc,
    // with a message we wrote on purpose — including the TIER_LIMIT_*
    // sentinel strings the client parses) are untouched here; only the
    // default INTERNAL_SERVER_ERROR code — meaning something we did NOT
    // anticipate — gets its message swapped for a generic one. The full
    // original error, unredacted, is always logged server-side first so
    // this is a client-facing sanitization only, not a loss of diagnostic
    // information for you.
    if (error.code === "INTERNAL_SERVER_ERROR") {
      console.error("[tRPC INTERNAL_SERVER_ERROR]", error.cause ?? error);
      return {
        ...shape,
        message: "Something went wrong on our end — please try again. If it keeps happening, contact support.",
      };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  if (ctx.clinic) {
    const access = getClinicAccessStatus(ctx.clinic);
    if (!access.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: access.reason === "suspended" ? SUBSCRIPTION_SUSPENDED_ERR_MSG : TRIAL_EXPIRED_ERR_MSG,
      });
    }
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

// ─── Rate limiting ────────────────────────────────────────────────────────
// Same in-memory fixed-window pattern already used for password-reset and
// OTP cooldowns in routers.ts, generalised into reusable middleware. One
// Render/Railway instance is fine at this scale; swap for Redis if this
// ever runs multiple replicas (same caveat as the existing cooldown maps).
type RateBucket = { count: number; windowStart: number };
const rateBuckets = new Map<string, RateBucket>();
let lastRateBucketPrune = Date.now();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();

  // Opportunistic prune so this map can't grow unbounded across many
  // distinct users/IPs — piggybacks on real traffic instead of a timer.
  if (now - lastRateBucketPrune > 10 * 60_000) {
    lastRateBucketPrune = now;
    for (const [k, b] of rateBuckets) {
      if (now - b.windowStart > windowMs) rateBuckets.delete(k);
    }
  }

  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart > windowMs) {
    rateBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= maxRequests) return false;
  bucket.count++;
  return true;
}

/**
 * Rate-limits a procedure per authenticated user (falls back to remote IP
 * for public procedures). Use on anything that hits the DB on every
 * keystroke-driven query (search endpoints) or could otherwise be hammered
 * cheaply by one logged-in account — e.g. patient.search, drug.search.
 */
export function rateLimited(maxRequests: number, windowMs: number) {
  return t.middleware(async ({ ctx, next, path }) => {
    const identity = ctx.user ? `u${ctx.user.id}` : ctx.req.ip ?? "anon";
    const key = `${identity}:${path}`;
    if (!checkRateLimit(key, maxRequests, windowMs)) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many requests — please slow down and try again in a moment.",
      });
    }
    return next();
  });
}

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

// Gates the /owner platform dashboard and any cross-clinic operation.
// Deliberately NOT the same as adminProcedure: 'admin' is a per-clinic
// role that every clinic's first registered user automatically receives,
// so it says nothing about who owns the platform. This checks the actual
// logged-in email against OWNER_EMAIL instead. If OWNER_EMAIL isn't set,
// this fails closed (rejects everyone) rather than granting access.
export const ownerProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (
      !ctx.user ||
      !ENV.ownerEmail ||
      ctx.user.email?.toLowerCase() !== ENV.ownerEmail.toLowerCase()
    ) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
