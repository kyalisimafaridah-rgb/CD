import { z } from "zod";
import { timingSafeEqual } from "crypto";
import { TRPCError } from "@trpc/server";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { ENV } from "./env";
import { runFullBackup } from "../backup";

function secretsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  // Called by an external cron (Render Cron Job, GitHub Actions scheduled
  // workflow, cron-job.org, etc.) — see server/backup.ts and
  // BACKUP_CRON_SECRET in .env.example. Deliberately public (no session
  // cookie exists for a cron caller) but requires the shared secret, and
  // fails closed if the secret isn't configured at all.
  runScheduledBackup: publicProcedure
    .input(z.object({ secret: z.string() }))
    .mutation(async ({ input }) => {
      if (!secretsMatch(input.secret, ENV.backupCronSecret)) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      return await runFullBackup();
    }),
});
