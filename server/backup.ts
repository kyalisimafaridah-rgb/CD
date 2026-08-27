// Database backup — exports the core tables to R2 as JSON and stamps
// clinics.lastBackupDate. This existed as a schema column
// (clinics.lastBackupDate) with nothing ever writing to it; Aiven's
// managed MySQL almost certainly already takes its own infra-level
// snapshots (check the Aiven dashboard — this doesn't replace that), but
// there was no app-level, R2-portable backup you could restore from
// without Aiven support, and no record of whether one had ever run.
//
// Triggered two ways:
//   1. admin.triggerBackup (adminProcedure) — manual, from Owner Dashboard.
//   2. system.runScheduledBackup (public, secret-protected) — for an
//      external cron (Render Cron Job, GitHub Actions scheduled workflow,
//      cron-job.org, etc.) to hit on a schedule, since a Render web
//      service alone has no built-in cron. Requires BACKUP_CRON_SECRET to
//      be set — see .env.example.

import { getDb } from "./db";
import { storagePut } from "./storage";
import {
  clinics, users, patients, visits, labTests, prescribedDrugs, bills,
  payments, drugs, drugStockHistory, appointments, invites,
} from "../drizzle/schema";

export type BackupResult = {
  timestamp: string;
  tables: Record<string, number>;
  clinicsStamped: number;
};

// Tables backed up wholesale. Excludes: otpCodes (short-lived, not worth
// restoring), smsNotifications and activityLog (high-volume audit trails —
// valuable operationally but not data loss you'd lose sleep over, and
// including them would balloon backup size for little recovery benefit),
// subscriptionEvents and serviceTemplates (low-value/regeneratable).
// Revisit this list if that judgment call turns out wrong for your usage.
const BACKUP_TABLES = {
  clinics, users, patients, visits, labTests, prescribedDrugs, bills,
  payments, drugs, drugStockHistory, appointments, invites,
} as const;

/**
 * Dumps every row of every table in BACKUP_TABLES to R2 as one JSON file
 * per table, under backups/<ISO-date>/<table>.json, then stamps
 * clinics.lastBackupDate = now for every clinic. Never throws for a
 * single-table failure — records what succeeded and what didn't so a
 * partial backup is still visible instead of silently looking complete.
 */
export async function runFullBackup(): Promise<BackupResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const timestamp = new Date().toISOString();
  const datePrefix = timestamp.slice(0, 10); // YYYY-MM-DD
  const tableCounts: Record<string, number> = {};
  const errors: string[] = [];

  for (const [name, table] of Object.entries(BACKUP_TABLES)) {
    try {
      const rows = await db.select().from(table as any);
      await storagePut(
        `backups/${datePrefix}/${name}.json`,
        JSON.stringify({ table: name, exportedAt: timestamp, rowCount: rows.length, rows }),
        "application/json"
      );
      tableCounts[name] = rows.length;
    } catch (error) {
      console.error(`[Backup] Failed to back up table "${name}":`, error);
      errors.push(name);
    }
  }

  // Stamp every clinic's lastBackupDate so Settings/Owner Dashboard can
  // show "last backed up: <date>" instead of it being permanently null.
  // Only stamped if at least one table succeeded — an all-failed run
  // shouldn't claim a backup happened.
  let clinicsStamped = 0;
  if (Object.keys(tableCounts).length > 0) {
    const result = await db.update(clinics).set({ lastBackupDate: new Date(timestamp) });
    clinicsStamped = Number((result as any)?.rowCount ?? (result as any)?.[0]?.affectedRows ?? (result as any)?.count ?? 0);
  }

  if (errors.length > 0) {
    console.error(`[Backup] Completed with failures on: ${errors.join(", ")}`);
  }

  return { timestamp, tables: tableCounts, clinicsStamped };
}
