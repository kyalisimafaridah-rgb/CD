import { eq, and, or, desc, asc, like, gte, lte, between, ne, isNull, notInArray, sql } from "drizzle-orm";
import { formatBillNumber } from "@shared/billing";
import { formatPatientId } from "@shared/patients";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  InsertUser,
  users,
  clinics,
  patients,
  visits,
  bills,
  drugs,
  appointments,
  labTests,
  prescribedDrugs,
  payments,
  smsNotifications,
  activityLog,
  drugStockHistory,
  invites,
  otpCodes,
  serviceTemplates,
  subscriptionEvents,
} from "../drizzle/schema";

// Supabase Postgres connection via postgres.js.
// Use the "Transaction" pooler URI (port 6543) on Render free tier, or the
// direct connection (port 5432) for migrations. SSL is required by Supabase.
let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _client = postgres(process.env.DATABASE_URL, {
        max: 10,
        idle_timeout: 20,
        connect_timeout: 10,
        ssl: "require",
        prepare: false, // required for Supabase transaction pooler (PgBouncer)
      });
      _db = drizzle(_client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      _client = null;
    }
  }
  return _db;
}

/** Force the client to be recreated on the next getDb() call. */
export function resetDb(): void {
  if (_client) {
    try {
      void _client.end({ timeout: 1 });
    } catch {
      /* ignore */
    }
  }
  _client = null;
  _db = null;
}

/**
 * Runs `fn` inside a Postgres transaction.
 * The transaction client `tx` is passed into `fn` — callers MUST use it
 * for every query that should be part of the transaction. Calling getDb()
 * inside the callback acquires a separate connection and bypasses
 * the transaction entirely.
 */
export async function withTransaction<T>(
  fn: (tx: NonNullable<Awaited<ReturnType<typeof getDb>>>) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(async (tx) => fn(tx as any));
}

/**
 * Atomically deducts `quantity` from a drug's stock using a single SQL UPDATE.
 * Returns true if the deduction succeeded (sufficient stock existed),
 * false if stock was insufficient (0 rows updated — race-safe).
 */
export async function deductDrugStockAtomic(
  drugId: number,
  quantity: number,
  tx?: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<{ success: boolean; previousQuantity: number; newQuantity: number }> {
  const conn = tx ?? await getDb();
  if (!conn) throw new Error("Database not available");

  const current = await conn.select({ quantity: drugs.quantity })
    .from(drugs)
    .where(eq(drugs.id, drugId))
    .limit(1);

  if (!current[0]) return { success: false, previousQuantity: 0, newQuantity: 0 };
  const prev = current[0].quantity;

  const result = await conn.update(drugs)
    .set({ quantity: sql`quantity - ${quantity}` })
    .where(and(eq(drugs.id, drugId), gte(drugs.quantity, quantity)));

  const rowsAffected = Number((result as any)?.rowCount ?? (result as any)[0]?.affectedRows ?? (result as any)?.count ?? 0);
  if (rowsAffected === 0) {
    return { success: false, previousQuantity: prev, newQuantity: prev };
  }
  return { success: true, previousQuantity: prev, newQuantity: prev - quantity };
}

export async function addDrugStockAtomic(
  drugId: number,
  quantity: number,
  tx?: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<{ previousQuantity: number; newQuantity: number }> {
  const conn = tx ?? await getDb();
  if (!conn) throw new Error("Database not available");

  const current = await conn.select({ quantity: drugs.quantity })
    .from(drugs)
    .where(eq(drugs.id, drugId))
    .limit(1);

  const prev = current[0]?.quantity ?? 0;

  await conn.update(drugs)
    .set({ quantity: sql`quantity + ${quantity}` })
    .where(eq(drugs.id, drugId));

  return { previousQuantity: prev, newQuantity: prev + quantity };
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function hasAnyUsers(): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.select({ id: users.id }).from(users).limit(1);
  return result.length > 0;
}

export async function touchLastSignedIn(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, userId));
}

export async function bumpSessionVersion(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, userId));
  const result = await db.select({ sessionVersion: users.sessionVersion }).from(users).where(eq(users.id, userId)).limit(1);
  return result.length > 0 ? result[0].sessionVersion : 0;
}

export async function incrementFailedLoginAttempts(userId: number): Promise<{ attempts: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ failedLoginAttempts: sql`${users.failedLoginAttempts} + 1` }).where(eq(users.id, userId));
  const result = await db.select({ failedLoginAttempts: users.failedLoginAttempts }).from(users).where(eq(users.id, userId)).limit(1);
  return { attempts: result.length > 0 ? result[0].failedLoginAttempts : 0 };
}

export async function lockUserUntil(userId: number, until: Date): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ lockedUntil: until }).where(eq(users.id, userId));
}

export async function clearFailedLoginAttempts(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, userId));
}

export async function getUserByPhone(phone: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ===== OTP CODES =====

export async function createOtpCode(phone: string, codeHash: string, expiresAt: Date): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(otpCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.usedAt)));
  await db.insert(otpCodes).values({ phone, codeHash, expiresAt });
}

export async function getLatestOtpForPhone(phone: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.usedAt), gte(otpCodes.expiresAt, new Date())))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function incrementOtpAttempts(otpId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(otpCodes).set({ attempts: sql`attempts + 1` }).where(eq(otpCodes.id, otpId));
  const result = await db.select({ attempts: otpCodes.attempts }).from(otpCodes).where(eq(otpCodes.id, otpId)).limit(1);
  return result.length > 0 ? result[0].attempts : 0;
}

export async function markOtpUsed(otpId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(otpCodes).set({ usedAt: new Date() }).where(eq(otpCodes.id, otpId));
}

// ===== PASSWORD RESET =====

export async function setPasswordResetToken(userId: number, token: string, expiresAt: Date): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ passwordResetToken: token, passwordResetExpiresAt: expiresAt }).where(eq(users.id, userId));
}

export async function getUserByPasswordResetToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users)
    .where(and(eq(users.passwordResetToken, token), gte(users.passwordResetExpiresAt, new Date())))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function applyPasswordReset(userId: number, passwordHash: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({
    passwordHash,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    sessionVersion: sql`${users.sessionVersion} + 1`,
  }).where(eq(users.id, userId));
}

export async function getUsersByClinic(clinicId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(users).where(eq(users.clinicId, clinicId)).orderBy(asc(users.createdAt));
}

export async function getUserByIdAndClinic(userId: number, clinicId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users)
    .where(and(eq(users.id, userId), eq(users.clinicId, clinicId)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateUserRole(userId: number, role: "receptionist" | "doctor" | "manager") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(users).set({ role }).where(eq(users.id, userId));
}

/** Changes a user's password. The router calls setSessionCookie right after
 * this, which bumps sessionVersion (invalidating any other active sessions
 * for this account — the right move right after a password change) while
 * reissuing a fresh valid cookie for the session that made the change. */
export async function updateUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

export async function updateUserActiveStatus(userId: number, isActive: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(users).set({ isActive }).where(eq(users.id, userId));
}

// ===== STAFF INVITES =====

export async function createInviteAndReturnId(invite: typeof invites.$inferInsert): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(invites).values(invite).returning({ id: invites.id });
  return extractInsertId(result);
}

export async function getInviteByToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(invites).where(eq(invites.token, token)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getInviteById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(invites).where(eq(invites.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getPendingInvitesByClinic(clinicId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(invites)
    .where(and(
      eq(invites.clinicId, clinicId),
      isNull(invites.usedAt),
      gte(invites.expiresAt, new Date()),
    ))
    .orderBy(desc(invites.createdAt));
}

export async function markInviteUsed(inviteId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(invites).set({ usedAt: new Date() }).where(eq(invites.id, inviteId));
}

export async function updateInviteExpiry(inviteId: number, expiresAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(invites).set({ expiresAt }).where(eq(invites.id, inviteId));
}

export async function deleteInvite(inviteId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.delete(invites).where(eq(invites.id, inviteId));
}

/** Extract the new row id from a Drizzle insert.
 *  Postgres: use .returning({ id }) so result is [{ id: number }].
 *  Legacy MySQL insertId shape is still accepted for safety.
 */
function extractInsertId(result: unknown): number {
  const row = Array.isArray(result) ? result[0] : result;
  if (row && typeof row === "object") {
    const r = row as { id?: number; insertId?: number };
    if (typeof r.id === "number" && r.id > 0) return r.id;
    if (typeof r.insertId === "number" && r.insertId > 0) return r.insertId;
  }
  throw new Error("Insert did not return a valid id");
}

export async function createUserAndReturnId(user: InsertUser): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(users).values(user).returning({ id: users.id });
  return extractInsertId(result);
}

export async function createClinicAndReturnId(clinic: typeof clinics.$inferInsert): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(clinics).values(clinic).returning({ id: clinics.id });
  return extractInsertId(result);
}

export async function getClinicById(clinicId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getClinicsByOwner(ownerId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(clinics).where(eq(clinics.ownerId, ownerId)).orderBy(asc(clinics.name));
}

export async function updateUserClinic(userId: number, clinicId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ clinicId }).where(eq(users.id, userId));
}

export async function setClinicOwner(clinicId: number, ownerId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(clinics).set({ ownerId }).where(eq(clinics.id, clinicId));
}

export async function createClinic(clinic: typeof clinics.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(clinics).values(clinic);
  return result;
}

export async function getPatientsByClinic(clinicId: number, limit = 2000, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(patients)
    .where(and(eq(patients.clinicId, clinicId), eq(patients.isActive, true)))
    .orderBy(desc(patients.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getInactivePatients(clinicId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(patients)
    .where(and(eq(patients.clinicId, clinicId), eq(patients.isActive, false)))
    .orderBy(desc(patients.createdAt));
}

export async function restorePatient(patientId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(patients).set({ isActive: true }).where(eq(patients.id, patientId));
}

export async function countPatientsThisMonth(clinicId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(patients)
    .where(and(
      eq(patients.clinicId, clinicId),
      gte(patients.createdAt, startOfMonth),
    ));
  return Number(result[0]?.count ?? 0);
}

/**
 * Counts visits logged this calendar month for ANY patient at this clinic —
 * newly registered this month or years ago, doesn't matter. Uses visits.createdAt
 * (server-generated, not client-settable) rather than visits.visitDate, so this
 * can't be gamed by backdating a visit's recorded date.
 */
export async function countVisitsThisMonth(clinicId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(visits)
    .where(and(
      eq(visits.clinicId, clinicId),
      gte(visits.createdAt, startOfMonth),
    ));
  return Number(result[0]?.count ?? 0);
}

export async function countActiveStaff(clinicId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(and(
      eq(users.clinicId, clinicId),
      eq(users.isActive, true),
    ));
  return Number(result[0]?.count ?? 0);
}

export async function countBranches(ownerId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(clinics)
    .where(eq(clinics.ownerId, ownerId));
  return Number(result[0]?.count ?? 0);
}

export async function searchPatients(clinicId: number, searchTerm: string) {
  const db = await getDb();
  if (!db) return [];
  const term = `%${searchTerm}%`;
  return await db
    .select()
    .from(patients)
    .where(
      and(
        eq(patients.clinicId, clinicId),
        eq(patients.isActive, true),
        or(
          like(patients.firstName, term),
          like(patients.lastName, term),
          like(patients.phone, term),
          like(patients.patientId, term),
        )
      )
    )
    .limit(50);
}

export async function findPatientsByPhone(clinicId: number, phone: string) {
  const db = await getDb();
  if (!db) return [];
  const term = `%${phone}%`;
  return await db
    .select()
    .from(patients)
    .where(and(eq(patients.clinicId, clinicId), eq(patients.isActive, true), like(patients.phone, term)))
    .limit(10);
}

export async function getPatientById(patientId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getPatientByPatientId(patientId: string, clinicId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(patients)
    .where(and(eq(patients.patientId, patientId), eq(patients.clinicId, clinicId)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createPatient(patient: typeof patients.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(patients).values(patient);
  return result;
}

export async function updatePatient(patientId: number, updates: Partial<typeof patients.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(patients).set(updates).where(eq(patients.id, patientId));
}

/**
 * Handles an inbound "STOP" SMS reply. All clinics share one Africa's
 * Talking account/shortcode, so an inbound message can't be attributed to a
 * single clinic — opt the phone number out everywhere it appears rather
 * than guessing which clinic it was meant for.
 */
export async function optOutPatientsByPhone(phone: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const digits = phone.replace(/\D/g, "").slice(-9); // match on last 9 digits, ignoring country code formatting
  if (digits.length < 7) return 0;
  const result = await db.update(patients).set({ smsOptOut: true }).where(like(patients.phone, `%${digits}`));
  return Number((result as any)?.rowCount ?? (result as any)?.[0]?.affectedRows ?? (result as any)?.count ?? 0);
}

export async function deletePatient(patientId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(patients).set({ isActive: false }).where(eq(patients.id, patientId));
}

export async function getNextPatientId(clinicId: number): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .select()
    .from(patients)
    .where(eq(patients.clinicId, clinicId))
    .orderBy(desc(patients.id))
    .limit(1);

  const lastId = result.length > 0 ? parseInt(result[0].patientId.split("-")[1] || "0") : 0;
  return formatPatientId(lastId + 1);
}

/**
 * Offline-sync idempotency lookup. If a device queued this create while
 * offline and the sync engine retries it (e.g. the request succeeded but
 * the response was lost to a dropped connection), this lets the mutation
 * detect "I already did this" and return the original record instead of
 * creating a duplicate patient.
 */
/**
 * Detects a unique-constraint violation on a specific column.
 * Postgres uses SQLSTATE 23505; MySQL used ER_DUP_ENTRY. The constraint /
 * column name is matched in constraint, detail, or message so we can tell
 * a clientMutationId idempotency hit apart from e.g. a patientId collision.
 */
export function isDuplicateOnColumn(error: any, columnName: string): boolean {
  // Postgres: SQLSTATE 23505 unique_violation. Constraint/column name appears
  // in error.constraint or error.detail / error.message depending on driver.
  const code = String(error?.code ?? error?.errno ?? "");
  const hay = `${error?.constraint ?? ""} ${error?.detail ?? ""} ${error?.message ?? ""}`.toLowerCase();
  const isUnique = code === "23505" || code === "ER_DUP_ENTRY";
  return isUnique && hay.includes(columnName.toLowerCase());
}

/**
 * Thrown when a clientMutationId collision is detected on a row that is
 * NOT safe to just "return the existing id and carry on" — because the
 * insert is one step of a larger multi-step transaction (visit creation:
 * visit + labs + drugs + bill). Silently returning the winner's id there
 * would make the loser replay all the *downstream* steps a second time
 * (double stock deduction, a second bill) against a visit that's already
 * fully billed. Callers that hit this must abort the whole transaction and
 * report the write as already-synced, not keep going.
 */
export class DuplicateMutationError extends Error {
  constructor(public readonly existingId: number) {
    super("Duplicate clientMutationId — this exact write already exists");
    this.name = "DuplicateMutationError";
  }
}

export async function getPatientByClientMutationId(clientMutationId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(patients).where(eq(patients.clientMutationId, clientMutationId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createPatientWithGeneratedId(
  clinicId: number,
  data: Omit<typeof patients.$inferInsert, "patientId" | "clinicId">
): Promise<{ patientId: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const patientId = await getNextPatientId(clinicId);
    try {
      await db.insert(patients).values({ ...data, clinicId, patientId });
      return { patientId };
    } catch (error: any) {
      if (data.clientMutationId && isDuplicateOnColumn(error, "clientMutationId")) {
        // A concurrent replay of the same offline-queued submission won the
        // race and already inserted this exact record. Not an error —
        // report the record that's actually there instead of retrying
        // (retrying would hit the same clientMutationId constraint forever)
        // or throwing (which would surface as a failed sync to a write
        // that in fact succeeded).
        const existing = await getPatientByClientMutationId(data.clientMutationId);
        if (existing) return { patientId: existing.patientId };
      }
      if ((error?.code === "ER_DUP_ENTRY" || error?.code === "23505") && attempt < MAX_ATTEMPTS) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Failed to generate a unique patient ID after multiple attempts");
}

// ===== VISITS =====

export async function updateVisit(visitId: number, updates: Partial<typeof visits.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(visits).set(updates).where(eq(visits.id, visitId));
}

export async function getVisitsByPatient(patientId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(visits)
    .where(eq(visits.patientId, patientId))
    .orderBy(desc(visits.visitDate));
}

export async function getVisitById(visitId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(visits).where(eq(visits.id, visitId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getVisitByClientMutationId(clientMutationId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(visits).where(eq(visits.clientMutationId, clientMutationId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createVisit(visit: typeof visits.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(visits).values(visit);
  return result;
}

// tx param: pass the transaction client so visit creation is part of the atomic visit flow
export async function createVisitAndReturnId(
  visit: typeof visits.$inferInsert,
  tx?: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<number> {
  const conn = tx ?? await getDb();
  if (!conn) throw new Error("Database not available");
  try {
    const result = await conn.insert(visits).values(visit).returning({ id: visits.id });
    return extractInsertId(result);
  } catch (error: any) {
    if (visit.clientMutationId && isDuplicateOnColumn(error, "clientMutationId")) {
      const existing = await getVisitByClientMutationId(visit.clientMutationId);
      // Unlike patient/appointment/payment creates, a visit is the first
      // step of a bundled transaction (labs, drug dispensing, billing all
      // follow). Returning existing.id here and letting the caller continue
      // would re-run every one of those downstream steps a second time
      // against an already-billed visit. Abort the whole transaction
      // instead — see DuplicateMutationError.
      if (existing) throw new DuplicateMutationError(existing.id);
    }
    throw error;
  }
}

// ===== DRUGS =====

export async function getDrugsByClinic(clinicId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(drugs)
    .where(and(eq(drugs.clinicId, clinicId), eq(drugs.isActive, true)))
    .orderBy(asc(drugs.drugName));
}

export async function searchDrugs(clinicId: number, searchTerm: string) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(drugs)
    .where(and(eq(drugs.clinicId, clinicId), like(drugs.drugName, `%${searchTerm}%`)))
    .limit(50);
}

export async function getDrugById(drugId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(drugs).where(eq(drugs.id, drugId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createDrug(drug: typeof drugs.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.insert(drugs).values(drug);
}

export async function updateDrugStock(drugId: number, newQuantity: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(drugs).set({ quantity: newQuantity }).where(eq(drugs.id, drugId));
}

export async function deleteDrug(drugId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(drugs).set({ isActive: false }).where(eq(drugs.id, drugId));
}

// ===== BILLS =====

export async function getBillsByClinic(clinicId: number, limit = 100, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(bills)
    .where(eq(bills.clinicId, clinicId))
    .orderBy(desc(bills.billDate))
    .limit(limit)
    .offset(offset);
}

export async function getBillById(billId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(bills).where(eq(bills.id, billId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// tx param: pass the transaction client for atomic bill creation
export async function createBill(
  bill: typeof bills.$inferInsert,
  tx?: NonNullable<Awaited<ReturnType<typeof getDb>>>
) {
  const conn = tx ?? await getDb();
  if (!conn) throw new Error("Database not available");
  return await conn.insert(bills).values(bill);
}

// tx param: pass the transaction client for atomic bill update (e.g. markAsPaid)
export async function updateBill(
  billId: number,
  updates: Partial<typeof bills.$inferInsert>,
  tx?: NonNullable<Awaited<ReturnType<typeof getDb>>>
) {
  const conn = tx ?? await getDb();
  if (!conn) throw new Error("Database not available");
  return await conn.update(bills).set(updates).where(eq(bills.id, billId));
}

export async function deleteBill(billId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.delete(bills).where(eq(bills.id, billId));
}

// ===== LAB TESTS =====

export async function getLabTestsByVisit(visitId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(labTests).where(eq(labTests.visitId, visitId));
}

// tx param: pass the transaction client for atomic lab test creation
export async function createLabTest(
  test: typeof labTests.$inferInsert,
  tx?: NonNullable<Awaited<ReturnType<typeof getDb>>>
) {
  const conn = tx ?? await getDb();
  if (!conn) throw new Error("Database not available");
  return await conn.insert(labTests).values(test);
}

// ===== PRESCRIBED DRUGS =====

export async function getPrescribedDrugsByVisit(visitId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(prescribedDrugs).where(eq(prescribedDrugs.visitId, visitId));
}

// tx param: pass the transaction client for atomic prescribed drug creation
export async function createPrescribedDrug(
  drug: typeof prescribedDrugs.$inferInsert,
  tx?: NonNullable<Awaited<ReturnType<typeof getDb>>>
) {
  const conn = tx ?? await getDb();
  if (!conn) throw new Error("Database not available");
  return await conn.insert(prescribedDrugs).values(drug);
}

// ===== APPOINTMENTS =====

export async function getAppointmentsByClinic(clinicId: number, fromDate: Date, toDate: Date) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        between(appointments.appointmentDate, fromDate, toDate)
      )
    )
    .orderBy(asc(appointments.appointmentDate));
}

export async function getAppointmentById(appointmentId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAppointmentByClientMutationId(clientMutationId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(appointments).where(eq(appointments.clientMutationId, clientMutationId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createAppointment(appointment: typeof appointments.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.insert(appointments).values(appointment);
}

export async function createAppointmentAndReturnId(
  appointment: typeof appointments.$inferInsert,
  tx?: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<number> {
  const conn = tx ?? await getDb();
  if (!conn) throw new Error("Database not available");
  try {
    const result = await conn.insert(appointments).values(appointment).returning({ id: appointments.id });
    return extractInsertId(result);
  } catch (error: any) {
    if (appointment.clientMutationId && isDuplicateOnColumn(error, "clientMutationId")) {
      const existing = await getAppointmentByClientMutationId(appointment.clientMutationId);
      if (existing) return existing.id;
    }
    throw error;
  }
}

/**
 * Locks the doctor's user row (SELECT ... FOR UPDATE) for the duration of
 * the enclosing transaction. Two concurrent booking attempts for the same
 * doctor will serialize on this lock, so the second request's conflict
 * check runs *after* the first request's insert has committed — closing
 * the race where both requests pass getConflictingAppointments before
 * either one inserts. Must be called inside withTransaction, before
 * getConflictingAppointments.
 */
export async function lockDoctorForBooking(tx: NonNullable<Awaited<ReturnType<typeof getDb>>>, doctorUserId: number): Promise<void> {
  await tx.execute(sql`SELECT id FROM ${users} WHERE id = ${doctorUserId} FOR UPDATE`);
}

/**
 * Finds appointments for the same doctor whose time window overlaps the
 * given start/duration. Two intervals [a, a+durA) and [b, b+durB) overlap
 * when a < b+durB AND b < a+durA. Only "scheduled"/"confirmed" appointments
 * count — cancelled/completed/no_show slots don't block a new booking.
 * excludeAppointmentId lets rescheduling ignore the appointment being moved.
 * Pass `tx` (after calling lockDoctorForBooking in the same transaction) to
 * make the check race-safe against concurrent bookings for this doctor.
 */
export async function getConflictingAppointments(
  clinicId: number,
  assignedDoctor: number,
  start: Date,
  durationMinutes: number,
  excludeAppointmentId?: number,
  tx?: NonNullable<Awaited<ReturnType<typeof getDb>>>
) {
  const conn = tx ?? await getDb();
  if (!conn) return [];
  const endTime = new Date(start.getTime() + durationMinutes * 60_000);
  const conditions = [
    eq(appointments.clinicId, clinicId),
    eq(appointments.assignedDoctor, assignedDoctor),
    or(eq(appointments.status, "scheduled"), eq(appointments.status, "confirmed")),
    // existing.start < newEnd AND newStart < existing.start + existing.duration
    sql`${appointments.appointmentDate} < ${endTime}`,
    sql`${start} < (${appointments.appointmentDate} + make_interval(mins => ${appointments.duration}))`,
  ];
  if (excludeAppointmentId) conditions.push(ne(appointments.id, excludeAppointmentId));
  return await conn.select().from(appointments).where(and(...conditions));
}

export async function updateAppointment(
  appointmentId: number,
  updates: Partial<typeof appointments.$inferInsert>,
  tx?: NonNullable<Awaited<ReturnType<typeof getDb>>>
) {
  const conn = tx ?? await getDb();
  if (!conn) throw new Error("Database not available");
  return await conn.update(appointments).set(updates).where(eq(appointments.id, appointmentId));
}

// ===== PAYMENTS =====

// tx param: pass the transaction client for atomic payment creation (with bill update)
export async function createPayment(
  payment: typeof payments.$inferInsert,
  tx?: NonNullable<Awaited<ReturnType<typeof getDb>>>
) {
  const conn = tx ?? await getDb();
  if (!conn) throw new Error("Database not available");
  return await conn.insert(payments).values(payment);
}

export async function getPaymentByClientMutationId(clientMutationId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(payments).where(eq(payments.clientMutationId, clientMutationId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ===== SERVICE TEMPLATES =====

export async function getServiceTemplatesByClinic(clinicId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(serviceTemplates)
    .where(and(eq(serviceTemplates.clinicId, clinicId), eq(serviceTemplates.isActive, true)))
    .orderBy(asc(serviceTemplates.category), asc(serviceTemplates.name));
}

export async function createServiceTemplate(template: typeof serviceTemplates.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.insert(serviceTemplates).values(template);
}

export async function deleteServiceTemplate(templateId: number, clinicId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(serviceTemplates)
    .set({ isActive: false })
    .where(and(eq(serviceTemplates.id, templateId), eq(serviceTemplates.clinicId, clinicId)));
}

// ===== DAILY CASH RECONCILIATION =====

export async function getDailyReconciliation(clinicId: number, date: Date) {
  const db = await getDb();
  if (!db) return { cash: 0, mtnMomo: 0, bankTransfer: 0, cheque: 0, total: 0, paymentCount: 0 };

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const clinicPayments = await db
    .select({ amount: payments.amount, paymentMethod: payments.paymentMethod })
    .from(payments)
    .innerJoin(bills, eq(payments.billId, bills.id))
    .where(and(
      eq(bills.clinicId, clinicId),
      eq(payments.status, "confirmed"),
      between(payments.paymentDate, startOfDay, endOfDay),
    ));

  const result = { cash: 0, mtnMomo: 0, bankTransfer: 0, cheque: 0, total: 0, paymentCount: clinicPayments.length };
  for (const p of clinicPayments) {
    const amount = Number(p.amount);
    result.total += amount;
    if (p.paymentMethod === "cash") result.cash += amount;
    else if (p.paymentMethod === "mtn_momo") result.mtnMomo += amount;
    else if (p.paymentMethod === "bank_transfer") result.bankTransfer += amount;
    else if (p.paymentMethod === "cheque") result.cheque += amount;
  }
  return result;
}

export async function deletePaymentsByBill(billId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.delete(payments).where(eq(payments.billId, billId));
}

export async function getPaymentsByBill(billId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(payments).where(eq(payments.billId, billId));
}

export async function getPendingFollowUps(clinicId: number) {
  const db = await getDb();
  if (!db) return [];
  const todayStr = new Date().toISOString().split("T")[0];
  return await db.select().from(visits)
    .where(and(
      eq(visits.clinicId, clinicId),
      eq(visits.followUpFlag, true),
      lte(visits.followUpDate, todayStr as any),
    ))
    .orderBy(asc(visits.followUpDate))
    .limit(20);
}

export async function getDoctorPerformance(clinicId: number, startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) return [];

  const visitsInRange = await db.select().from(visits)
    .where(and(
      eq(visits.clinicId, clinicId),
      between(visits.visitDate, startDate, endDate),
    ));

  const doctorIds = [...new Set(visitsInRange.map((v) => v.doctorId).filter(Boolean) as number[])];
  if (doctorIds.length === 0) return [];

  const doctors = await db.select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.clinicId, clinicId));

  const doctorMap = new Map(doctors.map((d) => [d.id, d.name]));

  return doctorIds.map((doctorId) => {
    const doctorVisits = visitsInRange.filter((v) => v.doctorId === doctorId);
    const revenue = doctorVisits.reduce((s, v) => s + parseFloat(v.consultationFee?.toString() || "0"), 0);
    return {
      doctorId,
      doctorName: doctorMap.get(doctorId) || `Doctor #${doctorId}`,
      visitCount: doctorVisits.length,
      revenue,
    };
  }).sort((a, b) => b.visitCount - a.visitCount);
}

export async function getRevenueByDateRange(
  clinicId: number,
  startDate: Date,
  endDate: Date
) {
  const db = await getDb();
  if (!db) return { totalRevenue: 0, unpaidAmount: 0, bills: [] };

  const billsInRange = await db
    .select()
    .from(bills)
    .where(
      and(
        eq(bills.clinicId, clinicId),
        between(bills.billDate, startDate, endDate)
      )
    );

  const totalRevenue = billsInRange
    .filter((b) => b.paymentStatus === "paid" || b.paymentStatus === "partial")
    .reduce((sum, b) => sum + parseFloat((b.amountPaid || 0).toString()), 0);

  const unpaidAmount = billsInRange
    .filter((b) => b.paymentStatus !== "paid")
    .reduce((sum, b) => sum + parseFloat(b.balanceAmount.toString()), 0);

  return { totalRevenue, unpaidAmount, bills: billsInRange };
}

// tx param: pass transaction client for optional transactional logging
export async function logActivity(
  activity: typeof activityLog.$inferInsert,
  tx?: NonNullable<Awaited<ReturnType<typeof getDb>>>
) {
  const conn = tx ?? await getDb();
  if (!conn) return;
  return await conn.insert(activityLog).values(activity);
}

export async function createSmsNotification(notification: typeof smsNotifications.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.insert(smsNotifications).values(notification);
}

export async function getSmsNotificationsByClinic(clinicId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(smsNotifications)
    .where(eq(smsNotifications.clinicId, clinicId))
    .orderBy(desc(smsNotifications.createdAt))
    .limit(limit);
}

export async function getActivityLogsByClinic(clinicId: number, limit = 200) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(activityLog)
    .where(eq(activityLog.clinicId, clinicId))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);
}

// tx param: pass transaction client for atomic stock history creation
export async function createDrugStockHistory(
  history: typeof drugStockHistory.$inferInsert,
  tx?: NonNullable<Awaited<ReturnType<typeof getDb>>>
) {
  const conn = tx ?? await getDb();
  if (!conn) throw new Error("Database not available");
  return await conn.insert(drugStockHistory).values(history);
}

export async function getDrugStockHistory(drugId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(drugStockHistory)
    .where(eq(drugStockHistory.drugId, drugId))
    .orderBy(desc(drugStockHistory.createdAt))
    .limit(limit);
}

export async function getNextBillNumber(
  clinicId: number,
  tx?: Awaited<ReturnType<typeof getDb>>
): Promise<string> {
  const conn = tx ?? await getDb();
  if (!conn) throw new Error("Database not available");

  const date = new Date();
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const monthPrefix = `INV-${year}${String(month).padStart(2, "0")}-`;

  const result = await conn
    .select()
    .from(bills)
    .where(and(eq(bills.clinicId, clinicId), like(bills.billNumber, `${monthPrefix}%`)))
    .orderBy(desc(bills.id))
    .limit(1)
    .for("update");

  const lastNumber = result.length > 0 ? parseInt(result[0].billNumber.split("-")[2] || "0") : 0;

  return formatBillNumber(year, month, lastNumber + 1);
}

export async function getTodayStats(clinicId: number) {
  const db = await getDb();
  if (!db) return { patientCount: 0, revenueCollected: 0, unpaidBillsCount: 0, unpaidBillsAmount: 0 };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayVisits = await db
    .select()
    .from(visits)
    .where(and(eq(visits.clinicId, clinicId), between(visits.visitDate, today, tomorrow)));

  const todayBills = await db
    .select()
    .from(bills)
    .where(and(eq(bills.clinicId, clinicId), between(bills.billDate, today, tomorrow)));

  const revenueCollected = todayBills
    .filter((b) => b.paymentStatus === "paid" || b.paymentStatus === "partial")
    .reduce((sum, b) => sum + parseFloat((b.amountPaid || 0).toString()), 0);

  const unpaidBills = todayBills.filter((b) => b.paymentStatus !== "paid");
  const unpaidBillsAmount = unpaidBills.reduce(
    (sum, b) => sum + parseFloat(b.balanceAmount.toString()),
    0
  );

  return {
    patientCount: new Set(todayVisits.map((v) => v.patientId)).size,
    revenueCollected,
    unpaidBillsCount: unpaidBills.length,
    unpaidBillsAmount,
  };
}

export async function getVisitsByClinic(clinicId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(visits)
    .where(eq(visits.clinicId, clinicId))
    .orderBy(desc(visits.createdAt))
    .limit(limit);
}

export async function getNextVisitNumber(clinicId: number): Promise<string> {
  const db = await getDb();
  if (!db) return "V-001";
  const all = await db.select().from(visits).where(eq(visits.clinicId, clinicId));
  return `V-${String(all.length + 1).padStart(3, "0")}`;
}

export async function getClinicStats(clinicId: number) {
  const db = await getDb();
  if (!db) return { totalPatients: 0, totalDrugs: 0 };
  const allPatients = await db.select().from(patients).where(eq(patients.clinicId, clinicId));
  const allDrugs = await db.select().from(drugs).where(eq(drugs.clinicId, clinicId));
  return { totalPatients: allPatients.length, totalDrugs: allDrugs.length };
}

export async function updateClinic(clinicId: number, updates: {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  country?: string;
  consultationFee?: string;
  mtnMomoNumber?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(clinics).set(updates as any).where(eq(clinics.id, clinicId));
}

export async function getAllClinics() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(clinics).orderBy(desc(clinics.createdAt));
}

/**
 * Every account gets a clinic created at registration, including the very
 * first one (which becomes admin) — so the admin's own account has a real,
 * usable clinic row sitting in the same table as actual customers. Without
 * this exclusion, platform stats (total clinics, MRR, patient counts,
 * churn) would silently include whatever the admin's own account has done,
 * inflating numbers that are supposed to represent the real customer base.
 */
async function getAdminOwnedClinicIds(): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ clinicId: users.clinicId })
    .from(users)
    .where(eq(users.role, "admin"));
  return rows.map(r => r.clinicId).filter((id): id is number => id !== null);
}

/**
 * Emails of active platform admins — used to alert someone in real time
 * when a billing webhook hits an edge case (unrecognised variant_id,
 * payment failure) instead of that only being visible if/when someone
 * happens to open Owner Dashboard. Filters out admins with no email (phone
 * OTP-only accounts) since there's nowhere to send it.
 */
export async function getAdminEmails(): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ email: users.email })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true)));
  return rows.map(r => r.email).filter((e): e is string => !!e);
}

export async function getAllClinicsWithStats() {
  const db = await getDb();
  if (!db) return [];
  const adminClinicIds = await getAdminOwnedClinicIds();
  const clinicFilter = adminClinicIds.length > 0 ? notInArray(clinics.id, adminClinicIds) : undefined;
  const allClinics = await db.select().from(clinics).where(clinicFilter).orderBy(desc(clinics.createdAt));

  // Grouped aggregates computed by the database — one row per clinic —
  // instead of pulling every patient/visit/bill row on the entire platform
  // into Node memory and filtering per-clinic in JS. The old approach was
  // O(clinics × total rows); at a few hundred patients this was invisible,
  // but at the 5,000+ patients / 10,000+ visits scale already flagged as an
  // open performance-test item, this was the query that would have made the
  // owner dashboard slow (or memory-heavy) to load.
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [patientCounts, visitStats, billStats, patientsThisMonth, visitsThisMonth] = await Promise.all([
    db.select({ clinicId: patients.clinicId, count: sql<number>`count(*)` })
      .from(patients).groupBy(patients.clinicId),
    db.select({
      clinicId: visits.clinicId,
      count: sql<number>`count(*)`,
      lastVisitAt: sql<string | null>`max(${visits.visitDate})`,
    }).from(visits).groupBy(visits.clinicId),
    db.select({
      clinicId: bills.clinicId,
      count: sql<number>`count(*)`,
      revenue: sql<number>`coalesce(sum(case when paymentStatus in ('paid','partial') then amountPaid else 0 end), 0)`,
      lastBillAt: sql<string | null>`max(${bills.billDate})`,
    }).from(bills).groupBy(bills.clinicId),
    db.select({ clinicId: patients.clinicId, count: sql<number>`count(*)` })
      .from(patients).where(gte(patients.createdAt, monthStart)).groupBy(patients.clinicId),
    db.select({ clinicId: visits.clinicId, count: sql<number>`count(*)` })
      .from(visits).where(gte(visits.visitDate, monthStart)).groupBy(visits.clinicId),
  ]);

  const patientsThisMonthMap = new Map(patientsThisMonth.map(p => [p.clinicId, Number(p.count)]));
  const visitsThisMonthMap = new Map(visitsThisMonth.map(v => [v.clinicId, Number(v.count)]));

  const patientMap = new Map(patientCounts.map(p => [p.clinicId, Number(p.count)]));
  const visitMap = new Map(visitStats.map(v => [v.clinicId, v]));
  const billMap = new Map(billStats.map(b => [b.clinicId, b]));

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  return allClinics.map(clinic => {
    const visitRow = visitMap.get(clinic.id);
    const billRow = billMap.get(clinic.id);
    const visitCount = visitRow ? Number(visitRow.count) : 0;
    const billCount = billRow ? Number(billRow.count) : 0;
    const totalRevenue = billRow ? Number(billRow.revenue) : 0;

    const lastVisitAt = visitRow?.lastVisitAt ? new Date(visitRow.lastVisitAt) : null;
    const lastBillAt = billRow?.lastBillAt ? new Date(billRow.lastBillAt) : null;
    const lastActiveAt = [lastVisitAt, lastBillAt]
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    const churnRisk = lastActiveAt ? lastActiveAt < sevenDaysAgo : visitCount === 0;
    const trialEndingSoon = clinic.trialEndsAt ? clinic.trialEndsAt <= threeDaysFromNow : false;

    return {
      ...clinic,
      patientCount: patientMap.get(clinic.id) ?? 0,
      visitCount,
      billCount,
      totalRevenue,
      lastActiveAt,
      churnRisk,
      trialEndingSoon,
      patientsThisMonth: patientsThisMonthMap.get(clinic.id) ?? 0,
      visitsThisMonth: visitsThisMonthMap.get(clinic.id) ?? 0,
    };
  });
}

export async function getOwnerRevenueStats() {
  const db = await getDb();
  if (!db) return { totalClinics: 0, activeClinics: 0, suspendedClinics: 0, totalPatients: 0, totalVisits: 0, newThisWeek: 0, newThisMonth: 0, totalRevenue: 0 };

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getFullYear(), now.getMonth(), 1);
  const adminClinicIds = await getAdminOwnedClinicIds();
  const excludeAdminClinics = (col: typeof clinics.id) =>
    adminClinicIds.length > 0 ? notInArray(col, adminClinicIds) : undefined;

  // Single-row aggregates — the database counts/sums instead of Node pulling
  // every clinic/patient/visit/bill row on the whole platform into memory
  // just to call .length and .filter().reduce() on them.
  const [[clinicStats], [patientStats], [visitStats], [billStats], [churnStats]] = await Promise.all([
    db.select({
      total: sql<number>`count(*)`,
      active: sql<number>`sum(case when subscriptionStatus = 'active' then 1 else 0 end)`,
      suspended: sql<number>`sum(case when subscriptionStatus = 'suspended' then 1 else 0 end)`,
      newThisWeek: sql<number>`sum(case when createdAt >= ${weekAgo} then 1 else 0 end)`,
      newThisMonth: sql<number>`sum(case when createdAt >= ${monthAgo} then 1 else 0 end)`,
    }).from(clinics).where(excludeAdminClinics(clinics.id)),
    db.select({ total: sql<number>`count(*)` }).from(patients).where(excludeAdminClinics(patients.clinicId)),
    db.select({ total: sql<number>`count(*)` }).from(visits).where(excludeAdminClinics(visits.clinicId)),
    db.select({
      revenue: sql<number>`coalesce(sum(case when paymentStatus in ('paid','partial') then amountPaid else 0 end), 0)`,
    }).from(bills).where(excludeAdminClinics(bills.clinicId)),
    db.select({
      cancelledThisMonth: sql<number>`sum(case when eventType = 'cancelled' and createdAt >= ${monthAgo} then 1 else 0 end)`,
      downgradedThisMonth: sql<number>`sum(case when eventType = 'downgraded' and createdAt >= ${monthAgo} then 1 else 0 end)`,
      upgradedThisMonth: sql<number>`sum(case when eventType = 'upgraded' and createdAt >= ${monthAgo} then 1 else 0 end)`,
      needsReviewCount: sql<number>`sum(case when needsReview = true and resolvedAt is null then 1 else 0 end)`,
    }).from(subscriptionEvents).where(excludeAdminClinics(subscriptionEvents.clinicId)),
  ]);

  return {
    totalClinics: Number(clinicStats?.total ?? 0),
    activeClinics: Number(clinicStats?.active ?? 0),
    suspendedClinics: Number(clinicStats?.suspended ?? 0),
    totalPatients: Number(patientStats?.total ?? 0),
    totalVisits: Number(visitStats?.total ?? 0),
    newThisWeek: Number(clinicStats?.newThisWeek ?? 0),
    newThisMonth: Number(clinicStats?.newThisMonth ?? 0),
    totalRevenue: Number(billStats?.revenue ?? 0),
    cancelledThisMonth: Number(churnStats?.cancelledThisMonth ?? 0),
    downgradedThisMonth: Number(churnStats?.downgradedThisMonth ?? 0),
    upgradedThisMonth: Number(churnStats?.upgradedThisMonth ?? 0),
    needsReviewCount: Number(churnStats?.needsReviewCount ?? 0),
  };
}

/** Records a subscription lifecycle event — called from the LemonSqueezy
 * webhook handler for every tier change, and from admin's manual tier
 * override, so churn stats and the "needs attention" panel see both. */
export async function logSubscriptionEvent(event: typeof subscriptionEvents.$inferInsert) {
  const db = await getDb();
  if (!db) return;
  return await db.insert(subscriptionEvents).values(event);
}

export async function getSubscriptionEventsNeedingReview() {
  const db = await getDb();
  if (!db) return [];
  const adminClinicIds = await getAdminOwnedClinicIds();
  const conditions = [eq(subscriptionEvents.needsReview, true), isNull(subscriptionEvents.resolvedAt)];
  if (adminClinicIds.length > 0) conditions.push(notInArray(subscriptionEvents.clinicId, adminClinicIds));
  return await db.select({
    id: subscriptionEvents.id,
    clinicId: subscriptionEvents.clinicId,
    clinicName: clinics.name,
    eventType: subscriptionEvents.eventType,
    fromTier: subscriptionEvents.fromTier,
    toTier: subscriptionEvents.toTier,
    note: subscriptionEvents.note,
    createdAt: subscriptionEvents.createdAt,
  })
    .from(subscriptionEvents)
    .innerJoin(clinics, eq(subscriptionEvents.clinicId, clinics.id))
    .where(and(...conditions))
    .orderBy(desc(subscriptionEvents.createdAt));
}

export async function resolveSubscriptionEvent(id: number, resolvedByUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(subscriptionEvents)
    .set({ resolvedAt: new Date(), resolvedByUserId })
    .where(eq(subscriptionEvents.id, id));
}

/** Platform-wide audit trail of admin actions (impersonation, suspend/
 * reactivate, manual tier changes, promotions) — previously these wrote to
 * each clinic's own activityLog (scoped + tier-gated, so an admin could
 * never actually see their own action history in one place). */
export async function getAdminAuditLog(limit = 200) {
  const db = await getDb();
  if (!db) return [];
  return await db.select({
    id: activityLog.id,
    action: activityLog.action,
    clinicId: activityLog.clinicId,
    clinicName: clinics.name,
    userId: activityLog.userId,
    adminName: users.name,
    entityType: activityLog.entityType,
    entityId: activityLog.entityId,
    changes: activityLog.changes,
    createdAt: activityLog.createdAt,
  })
    .from(activityLog)
    .innerJoin(clinics, eq(activityLog.clinicId, clinics.id))
    .leftJoin(users, eq(activityLog.userId, users.id))
    .where(like(activityLog.action, "ADMIN\\_%"))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);
}

export async function promoteUserToAdmin(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(users).set({ role: "admin" }).where(eq(users.id, userId));
}

export async function getClinicByLsSubscriptionId(lsSubscriptionId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(clinics).where(eq(clinics.lsSubscriptionId, lsSubscriptionId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateClinicBillingInfo(clinicId: number, updates: {
  subscriptionStatus?: "active" | "inactive" | "suspended";
  subscriptionTier?: "free" | "clinic" | "pro";
  lsCustomerId?: string;
  lsSubscriptionId?: string;
  subscriptionRenewsAt?: Date | null;
  gracePeriodEndsAt?: Date | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(clinics).set(updates).where(eq(clinics.id, clinicId));
}

/**
 * When a clinic's real LemonSqueezy subscription changes tier/status, any
 * sibling "branches" (same ownerId) that were created via addBranch's
 * one-time tier copy — and never checked out with their own subscription —
 * should follow the change too. Without this, a branch's tier was frozen
 * forever at whatever it was the day it was created: cancel the parent
 * subscription and the branches kept running on the old paid tier
 * indefinitely, with no billing behind them.
 */
export async function syncBranchTiersToOwner(
  billedClinicId: number,
  updates: { subscriptionTier?: "free" | "clinic" | "pro"; subscriptionStatus?: "active" | "inactive" | "suspended" }
) {
  const db = await getDb();
  if (!db) return;
  const billedClinic = await getClinicById(billedClinicId);
  if (!billedClinic?.ownerId) return;
  const siblings = await getClinicsByOwner(billedClinic.ownerId);
  for (const sibling of siblings) {
    // Skip the clinic we just billed, and skip any branch that has its own
    // independent LemonSqueezy subscription — only cascade to branches that
    // are riding on the owner's original subscription.
    if (sibling.id === billedClinicId || sibling.lsSubscriptionId) continue;
    await db.update(clinics).set(updates).where(eq(clinics.id, sibling.id));
  }
}

export async function updateClinicSubscription(clinicId: number, status: "active" | "inactive" | "suspended", tier?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updates: any = { subscriptionStatus: status };
  if (tier) updates.subscriptionTier = tier;
  return await db.update(clinics).set(updates).where(eq(clinics.id, clinicId));
}

// ===== DEBT TRACKING =====

export async function getDebtors(clinicId: number) {
  const db = await getDb();
  if (!db) return [];

  const debtBills = await db.select().from(bills)
    .where(and(
      eq(bills.clinicId, clinicId),
      ne(bills.paymentStatus, "paid"),
    ))
    .orderBy(desc(bills.billDate));

  const allPatients = await db.select().from(patients).where(eq(patients.clinicId, clinicId));

  const debtorMap = new Map<number, {
    patient: typeof allPatients[0];
    totalOwed: number;
    oldestBill: Date;
    billCount: number;
  }>();

  for (const bill of debtBills) {
    const patient = allPatients.find(p => p.id === bill.patientId);
    if (!patient) continue;
    const balance = Number(bill.balanceAmount);
    if (balance <= 0) continue;

    const existing = debtorMap.get(bill.patientId);
    const billDate = new Date(bill.billDate);
    if (existing) {
      existing.totalOwed += balance;
      existing.billCount += 1;
      if (billDate < existing.oldestBill) existing.oldestBill = billDate;
    } else {
      debtorMap.set(bill.patientId, {
        patient,
        totalOwed: balance,
        oldestBill: billDate,
        billCount: 1,
      });
    }
  }

  return Array.from(debtorMap.values())
    .sort((a, b) => b.totalOwed - a.totalOwed);
}

export async function getBillsByPatient(patientId: number, clinicId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(bills)
    .where(and(eq(bills.patientId, patientId), eq(bills.clinicId, clinicId)))
    .orderBy(desc(bills.billDate));
}

export async function getPatientFullHistory(patientId: number, clinicId: number) {
  const db = await getDb();
  if (!db) return null;

  const patient = await getPatientById(patientId);
  if (!patient || patient.clinicId !== clinicId) return null;

  const patientVisits = await getVisitsByPatient(patientId);
  const patientBills = await getBillsByPatient(patientId, clinicId);

  const visitsWithDetails = await Promise.all(
    patientVisits.map(async visit => {
      const labTestsForVisit = await getLabTestsByVisit(visit.id);
      const drugsForVisit = await getPrescribedDrugsByVisit(visit.id);
      const bill = patientBills.find(b => b.visitId === visit.id);
      return { ...visit, labTests: labTestsForVisit, drugs: drugsForVisit, bill };
    })
  );

  const totalSpent = patientBills
    .filter(b => b.paymentStatus === "paid" || b.paymentStatus === "partial")
    .reduce((sum, b) => sum + Number(b.amountPaid || 0), 0);

  const totalOwed = patientBills
    .filter(b => b.paymentStatus !== "paid")
    .reduce((sum, b) => sum + Number(b.balanceAmount), 0);

  return {
    patient,
    visits: visitsWithDetails,
    bills: patientBills,
    totalVisits: patientVisits.length,
    totalSpent,
    totalOwed,
  };
}
