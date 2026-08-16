import "dotenv/config";

// Every "today"/"this month" boundary in this app (daily cash reconciliation,
// monthly patient/visit quotas, invoice month prefixes) is computed with
// JS Date's local-time methods, which key off process.env.TZ. Render
// defaults to UTC; this clinic operates in East Africa Time (UTC+3). Set
// this as a fallback (not an override — an explicit TZ in the environment
// always wins) so correctness here doesn't silently depend on someone
// remembering to set it in the Render dashboard. See .env.example.
if (!process.env.TZ) {
  process.env.TZ = "Africa/Kampala";
}

import express, { type Request, type Response } from "express";
import { createServer } from "http";
import net from "net";
import { readFileSync } from "fs";
import { join } from "path";
import { sql } from "drizzle-orm";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { verifyLemonSqueezySignature, handleLemonSqueezyWebhook } from "./lemonsqueezy";
import { getDb } from "../db";
import * as dbModule from "../db";
import { ENV } from "./env";

type RequestWithRawBody = Request & { rawBody?: Buffer };

// drizzle-orm wraps driver errors in its own error class with a generic
// message like "Failed query: SELECT 1" — the SAME text regardless of
// whether the real cause is DNS failure, SSL handshake failure, a timeout,
// or bad credentials. The actual driver error (with .code, .errno, and a
// specific .message) is chained underneath via the standard Error.cause
// property. Without unwrapping it, every possible failure looks identical
// in the logs.
function describeError(err: unknown): string {
  const parts: string[] = [];
  let current: any = err;
  let depth = 0;
  while (current && depth < 5) {
    const bits = [
      current.code && `code=${current.code}`,
      current.errno !== undefined && `errno=${current.errno}`,
      current.message && `msg="${current.message}"`,
    ].filter(Boolean);
    if (bits.length) parts.push(bits.join(" "));
    current = current.cause;
    depth++;
  }
  return parts.length ? parts.join(" ← caused by ← ") : String(err);
}

// ─── Sentry error monitoring ──────────────────────────────────────────────────
let Sentry: typeof import("@sentry/node") | null = null;
if (ENV.sentryDsn) {
  import("@sentry/node").then((S) => {
    Sentry = S;
    S.init({
      dsn: ENV.sentryDsn,
      environment: process.env.NODE_ENV ?? "production",
      tracesSampleRate: 0.2,
    });
    console.log("[Sentry] Error monitoring initialised");
  }).catch(() => {
    console.warn("[Sentry] Failed to initialise — install @sentry/node to enable");
  });
}

// ─── Startup migrations ───────────────────────────────────────────────────────
// Runs every boot. All SQL statements use CREATE TABLE IF NOT EXISTS,
// ADD COLUMN IF NOT EXISTS, and CREATE INDEX IF NOT EXISTS so re-running
// on an already-migrated database is fully safe.
async function runStartupMigrations(): Promise<void> {
  console.log("[Migration] Running startup migrations...");

  const db = await getDb();
  if (!db) {
    console.warn("[Migration] Database not available — skipping migrations");
    return;
  }

  // Migration files live at <project root>/drizzle/ — resolved from cwd
  // so the path works both locally and on Render (where CWD = project root).
  const migrationsDir = join(process.cwd(), "drizzle");

  const migrationFiles = [
    "0000_absent_colleen_wing.sql",
    "0001_flaky_nekra.sql",
    "0002_caredesk_schema_sync.sql",
    "0003_indexes.sql",
    "0004_drug_soft_delete.sql",
    "0005_bill_isvoided.sql",
    "0006_offline_sync.sql",
    "0007_subscription_events.sql",
  ];

  for (const file of migrationFiles) {
    let content: string;
    try {
      content = readFileSync(join(migrationsDir, file), "utf-8");
    } catch {
      console.warn(`[Migration] Could not read ${file} — skipping`);
      continue;
    }

    // Drizzle migration files use "--> statement-breakpoint" as a delimiter.
    const statements = content
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => {
        // Drop empty or comment-only blocks
        const code = s.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));
        return code.length > 0;
      });

    let applied = 0;
    for (const statement of statements) {
      try {
        await db.execute(sql.raw(statement));
        applied++;
      } catch (err: any) {
        const errno = Number(err?.errno ?? 0);
        const code: string = err?.code ?? "";
        // Ignore "already exists" errors — migration was previously applied
        // Postgres SQLSTATEs + legacy MySQL codes (in case of mixed history)
        const benign = [
          1050, 1060, 1061, 1091,
        ].includes(errno) || [
          "ER_TABLE_EXISTS_ERROR",
          "ER_DUP_FIELDNAME",
          "ER_DUP_KEYNAME",
          "42P07", // duplicate_table
          "42701", // duplicate_column
          "42710", // duplicate_object (e.g. enum/type)
          "42P16", // invalid_table_definition sometimes used
          "23505", // unique_violation when re-creating indexes
        ].includes(code) || String(err?.message ?? "").toLowerCase().includes("already exists");
        if (benign) continue;

        // A SQL syntax error can NEVER mean "already applied" — it always
        // means this exact statement is malformed and has never once
        // succeeded, on any boot. Warning-and-continuing on this is what let
        // migration 0002's IF NOT EXISTS bug sit unnoticed for who knows how
        // long, with Render reporting the service "live" the entire time.
        // Fail loud instead: exit immediately so Render marks the deploy
        // failed and the problem is visible within seconds, not hours.
        const fatal = errno === 1064 || code === "ER_PARSE_ERROR" || code === "42601"; // syntax_error
        if (fatal) {
          console.error(`[Migration] FATAL syntax error in ${file} — refusing to start with a broken migration:`);
          console.error(`[Migration] ${describeError(err)}`);
          console.error(`[Migration] Statement: ${statement.slice(0, 300)}`);
          process.exit(1);
        }

        console.warn(`[Migration] Non-fatal error in ${file}: ${describeError(err)}`);
      }
    }
    console.log(`[Migration] ${file} — ${applied} statement(s) executed`);
  }

  // Deliberately NOT resetting the pool here — Previously Aiven MySQL/Render had a known issue
  // creating a second connection after the one established at server startup
  // (DNS ENOTFOUND). The pool that just ran migrations successfully is proven
  // to work; forcing a fresh one right before the health check recreates
  // exactly that failure.
  console.log("[Migration] Complete");
}

// ─── Startup health checks ────────────────────────────────────────────────────
async function runStartupHealthChecks(): Promise<void> {
  console.log("[Health] Running startup checks...");
  const results: { service: string; ok: boolean; note?: string }[] = [];

  // 1. Database
  try {
    const db = await getDb();
    if (db) {
      await db.execute(sql`SELECT 1`);
      results.push({ service: "Database", ok: true });
    } else {
      results.push({ service: "Database", ok: false, note: "DATABASE_URL not set or connection failed" });
    }
  } catch (err: any) {
    results.push({ service: "Database", ok: false, note: describeError(err) });
  }

  // 2. Africa's Talking SMS
  if (ENV.atApiKey && ENV.atUsername) {
    results.push({ service: "SMS (Africa's Talking)", ok: true, note: "credentials present" });
  } else {
    results.push({ service: "SMS (Africa's Talking)", ok: false, note: "AT_API_KEY or AT_USERNAME not set — SMS will silently fail" });
  }

  // 3. Resend email
  if (ENV.resendApiKey && ENV.resendApiKey !== "") {
    results.push({ service: "Email (Resend)", ok: true, note: "credentials present" });
  } else {
    results.push({ service: "Email (Resend)", ok: false, note: "RESEND_API_KEY not set — emails will silently fail" });
  }

  // 4. Lemonsqueezy payments
  if (ENV.lemonSqueezyApiKey && ENV.lemonSqueezyWebhookSecret && ENV.lemonVariantClinic && ENV.lemonVariantPro) {
    results.push({ service: "Payments (Lemonsqueezy)", ok: true, note: "credentials present" });
  } else {
    results.push({ service: "Payments (Lemonsqueezy)", ok: false, note: "Missing LEMON_* env vars — upgrade flow will not work" });
  }

  // 5. Sentry
  results.push({
    service: "Error monitoring (Sentry)",
    ok: Boolean(ENV.sentryDsn),
    note: ENV.sentryDsn ? "configured" : "SENTRY_DSN not set — errors won't be tracked",
  });

  for (const r of results) {
    const mark = r.ok ? "✅" : "⚠️ ";
    console.log(`[Health] ${mark} ${r.service}${r.note ? `: ${r.note}` : ""}`);
  }

  const failCount = results.filter(r => !r.ok).length;
  if (failCount > 0) {
    console.warn(`[Health] ${failCount} service(s) not fully configured — check env vars above`);
  } else {
    console.log("[Health] All services configured");
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      (req as RequestWithRawBody).rawBody = buf;
    },
  }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ─── Health check endpoint ────────────────────────────────────────────────
  app.get("/api/health", async (_req: Request, res: Response) => {
    let dbOk = false;
    try {
      const db = await getDb();
      if (db) {
        await db.execute(sql`SELECT 1`);
        dbOk = true;
      }
    } catch (err) {
      console.warn(`[Health] /api/health DB check failed: ${describeError(err)}`);
      dbOk = false;
    }
    const status = dbOk ? 200 : 503;
    res.status(status).json({
      ok: dbOk,
      db: dbOk,
      ts: new Date().toISOString(),
      env: process.env.NODE_ENV ?? "unknown",
    });
  });

  // ─── Lemonsqueezy webhooks ────────────────────────────────────────────────
  app.post("/api/webhooks/lemonsqueezy", async (req, res) => {
    const rawBody = (req as RequestWithRawBody).rawBody;
    const signature = req.headers["x-signature"];

    if (!rawBody || typeof signature !== "string" || !verifyLemonSqueezySignature(rawBody, signature)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    try {
      await handleLemonSqueezyWebhook(req.body);
    } catch (error) {
      console.error("[Lemonsqueezy] Webhook handler error:", error);
      if (Sentry) Sentry.captureException(error);
    }

    res.status(200).json({ received: true });
  });

  // ─── Africa's Talking inbound SMS (for "Reply STOP to opt out") ───────────
  // Configure this URL (https://<your-domain>/api/webhooks/sms-inbound) as
  // the callback URL in the Africa's Talking dashboard for this to receive
  // anything — AT doesn't push here on its own.
  app.post("/api/webhooks/sms-inbound", async (req, res) => {
    try {
      const from = String(req.body?.from ?? "");
      const text = String(req.body?.text ?? "").trim().toUpperCase();
      if (from && (text === "STOP" || text.startsWith("STOP "))) {
        const count = await dbModule.optOutPatientsByPhone(from);
        console.log(`[SMS] Inbound STOP from ${from} — opted out ${count} patient record(s)`);
      }
    } catch (error) {
      console.error("[SMS] Inbound webhook error:", error);
      if (Sentry) Sentry.captureException(error);
    }
    res.status(200).send("OK"); // AT expects a 200 regardless
  });

  // ─── tRPC API ─────────────────────────────────────────────────────────────
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError: ({ error, path }) => {
        if (error.code === "INTERNAL_SERVER_ERROR" && Sentry) {
          Sentry.captureException(error, { extra: { path } });
        }
        if (error.code === "INTERNAL_SERVER_ERROR") {
          console.error(`[tRPC] Internal error on ${path}:`, error);
        }
      },
    })
  );

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, async () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Migrations first — tables must exist before any request hits the DB
    await runStartupMigrations();
    // Health checks after migrations so DB state is accurate
    await runStartupHealthChecks();
  });
}

startServer().catch(console.error);
