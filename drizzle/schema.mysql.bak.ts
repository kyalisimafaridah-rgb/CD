import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  date,
  boolean,
  datetime,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow with role-based access control.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }).unique(),
  phone: varchar("phone", { length: 20 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  role: mysqlEnum("role", ["receptionist", "doctor", "manager", "admin"]).default("receptionist").notNull(),
  clinicId: int("clinicId"),
  isActive: boolean("isActive").default(true).notNull(),
  sessionVersion: int("sessionVersion").default(0).notNull(),
  failedLoginAttempts: int("failedLoginAttempts").default(0).notNull(),
  lockedUntil: timestamp("lockedUntil"),
  passwordResetToken: varchar("passwordResetToken", { length: 64 }),
  passwordResetExpiresAt: timestamp("passwordResetExpiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Clinic/Organization table for multi-clinic support
 */
export const clinics = mysqlTable("clinics", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  registrationNumber: varchar("registrationNumber", { length: 100 }),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  country: varchar("country", { length: 100 }).default("Uganda"),
  ownerId: int("ownerId"),
  consultationFee: decimal("consultationFee", { precision: 10, scale: 2 }).default("0"),
  mtnMomoNumber: varchar("mtnMomoNumber", { length: 20 }),
  subscriptionStatus: mysqlEnum("subscriptionStatus", ["active", "inactive", "suspended"]).default("active"),
  subscriptionTier: mysqlEnum("subscriptionTier", ["free", "clinic", "pro"]).default("free"),
  trialEndsAt: timestamp("trialEndsAt"),
  gracePeriodEndsAt: timestamp("gracePeriodEndsAt"),
  lsCustomerId: varchar("lsCustomerId", { length: 100 }),
  lsSubscriptionId: varchar("lsSubscriptionId", { length: 100 }),
  subscriptionRenewsAt: timestamp("subscriptionRenewsAt"),
  lastBackupDate: timestamp("lastBackupDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Clinic = typeof clinics.$inferSelect;
export type InsertClinic = typeof clinics.$inferInsert;

/**
 * Patients table
 */
export const patients = mysqlTable("patients", {
  id: int("id").autoincrement().primaryKey(),
  clinicId: int("clinicId").notNull(),
  patientId: varchar("patientId", { length: 20 }).notNull(), // P-001, P-002, etc — unique per clinic
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }),
  dateOfBirth: date("dateOfBirth"),
  age: int("age"),
  gender: mysqlEnum("gender", ["male", "female", "other"]),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  village: varchar("village", { length: 100 }),
  nextOfKin: varchar("nextOfKin", { length: 255 }),
  nextOfKinPhone: varchar("nextOfKinPhone", { length: 20 }),
  photoUrl: text("photoUrl"),
  medicalHistory: text("medicalHistory"),
  allergies: text("allergies"),
  flags: varchar("flags", { length: 255 }), // comma-separated: chronic, vip, owes_money, follow_up
  smsOptOut: boolean("smsOptOut").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  // Idempotency key set by offline clients. Lets a queued create survive being
  // replayed (e.g. after a flaky connection) without inserting the patient twice.
  clientMutationId: varchar("clientMutationId", { length: 36 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  // patientId is unique within a clinic, not globally — two clinics can both have P-001
  clinicPatientIdUnique: uniqueIndex("patients_clinicId_patientId_unique").on(table.clinicId, table.patientId),
  clientMutationIdUnique: uniqueIndex("patients_clientMutationId_unique").on(table.clientMutationId),
}));

export type Patient = typeof patients.$inferSelect;
export type InsertPatient = typeof patients.$inferInsert;

/**
 * Visits/Consultations table
 */
export const visits = mysqlTable("visits", {
  id: int("id").autoincrement().primaryKey(),
  clinicId: int("clinicId").notNull(),
  patientId: int("patientId").notNull(),
  visitDate: datetime("visitDate").notNull(),
  chiefComplaint: text("chiefComplaint"),
  clinicalNotes: text("clinicalNotes"),
  diagnosis: text("diagnosis"),
  consultationFee: decimal("consultationFee", { precision: 10, scale: 2 }).notNull(),
  doctorId: int("doctorId"),
  receptionistId: int("receptionistId"),
  status: mysqlEnum("status", ["pending", "open", "in_progress", "completed", "cancelled"]).default("completed"),
  prescriptionNotes: text("prescriptionNotes"),
  followUpFlag: boolean("followUpFlag").default(false).notNull(),
  followUpDate: date("followUpDate"),
  clientMutationId: varchar("clientMutationId", { length: 36 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  clientMutationIdUnique: uniqueIndex("visits_clientMutationId_unique").on(table.clientMutationId),
}));

export type Visit = typeof visits.$inferSelect;
export type InsertVisit = typeof visits.$inferInsert;

/**
 * Lab tests table (line items for visits)
 */
export const labTests = mysqlTable("labTests", {
  id: int("id").autoincrement().primaryKey(),
  visitId: int("visitId").notNull(),
  testName: varchar("testName", { length: 255 }).notNull(),
  cost: decimal("cost", { precision: 10, scale: 2 }).notNull(),
  result: text("result"),
  resultDate: datetime("resultDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LabTest = typeof labTests.$inferSelect;
export type InsertLabTest = typeof labTests.$inferInsert;

/**
 * Prescribed drugs table (line items for visits)
 */
export const prescribedDrugs = mysqlTable("prescribedDrugs", {
  id: int("id").autoincrement().primaryKey(),
  visitId: int("visitId").notNull(),
  drugId: int("drugId"),
  drugName: varchar("drugName", { length: 255 }).notNull(),
  dosage: varchar("dosage", { length: 100 }),
  quantity: int("quantity").notNull(),
  unit: varchar("unit", { length: 50 }),
  costPerUnit: decimal("costPerUnit", { precision: 10, scale: 2 }).notNull(),
  totalCost: decimal("totalCost", { precision: 10, scale: 2 }).notNull(),
  instructions: text("instructions"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PrescribedDrug = typeof prescribedDrugs.$inferSelect;
export type InsertPrescribedDrug = typeof prescribedDrugs.$inferInsert;

/**
 * Bills/Invoices table
 */
export const bills = mysqlTable("bills", {
  id: int("id").autoincrement().primaryKey(),
  clinicId: int("clinicId").notNull(),
  patientId: int("patientId").notNull(),
  visitId: int("visitId").notNull(),
  billNumber: varchar("billNumber", { length: 50 }).notNull(), // unique per clinic, not globally
  consultationFee: decimal("consultationFee", { precision: 10, scale: 2 }).notNull(),
  labTotal: decimal("labTotal", { precision: 10, scale: 2 }).default("0"),
  drugTotal: decimal("drugTotal", { precision: 10, scale: 2 }).default("0"),
  grandTotal: decimal("grandTotal", { precision: 10, scale: 2 }).notNull(),
  amountPaid: decimal("amountPaid", { precision: 10, scale: 2 }).default("0"),
  balanceAmount: decimal("balanceAmount", { precision: 10, scale: 2 }).notNull(),
  paymentStatus: mysqlEnum("paymentStatus", ["unpaid", "partial", "paid"]).default("unpaid"),
  paymentMethod: mysqlEnum("paymentMethod", ["cash", "mtn_momo", "bank_transfer", "cheque"]),
  isVoided: boolean("isVoided").default(false).notNull(),
  billDate: datetime("billDate").notNull(),
  dueDate: datetime("dueDate"),
  paidDate: datetime("paidDate"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  // billNumber is unique within a clinic, not globally — two clinics can both have INV-202507-0001
  clinicBillNumberUnique: uniqueIndex("bills_clinicId_billNumber_unique").on(table.clinicId, table.billNumber),
}));

export type Bill = typeof bills.$inferSelect;
export type InsertBill = typeof bills.$inferInsert;

/**
 * Payment transactions table
 */
export const payments = mysqlTable("payments", {
  id: int("id").autoincrement().primaryKey(),
  billId: int("billId").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: mysqlEnum("paymentMethod", ["cash", "mtn_momo", "bank_transfer", "cheque"]).notNull(),
  paymentDate: datetime("paymentDate").notNull(),
  transactionId: varchar("transactionId", { length: 100 }),
  status: mysqlEnum("status", ["pending", "confirmed", "failed"]).default("pending"),
  notes: text("notes"),
  clientMutationId: varchar("clientMutationId", { length: 36 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  clientMutationIdUnique: uniqueIndex("payments_clientMutationId_unique").on(table.clientMutationId),
}));

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

/**
 * Drug stock/inventory table
 */
export const drugs = mysqlTable("drugs", {
  id: int("id").autoincrement().primaryKey(),
  clinicId: int("clinicId").notNull(),
  drugName: varchar("drugName", { length: 255 }).notNull(),
  genericName: varchar("genericName", { length: 255 }),
  quantity: int("quantity").notNull(),
  unit: varchar("unit", { length: 50 }).notNull(), // tablets, ml, etc
  costPerUnit: decimal("costPerUnit", { precision: 10, scale: 2 }).notNull(),
  sellingPrice: decimal("sellingPrice", { precision: 10, scale: 2 }).notNull(),
  lowStockThreshold: int("lowStockThreshold").notNull(),
  expiryDate: date("expiryDate"),
  batchNumber: varchar("batchNumber", { length: 100 }),
  supplier: varchar("supplier", { length: 255 }),
  lastRestockDate: datetime("lastRestockDate"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Drug = typeof drugs.$inferSelect;
export type InsertDrug = typeof drugs.$inferInsert;

/**
 * Drug stock history/audit trail
 */
export const drugStockHistory = mysqlTable("drugStockHistory", {
  id: int("id").autoincrement().primaryKey(),
  drugId: int("drugId").notNull(),
  transactionType: mysqlEnum("transactionType", ["add", "deduct", "restock", "adjustment"]).notNull(),
  quantityChanged: int("quantityChanged").notNull(),
  previousQuantity: int("previousQuantity").notNull(),
  newQuantity: int("newQuantity").notNull(),
  reason: text("reason"),
  userId: int("userId"),
  visitId: int("visitId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DrugStockHistory = typeof drugStockHistory.$inferSelect;
export type InsertDrugStockHistory = typeof drugStockHistory.$inferInsert;

/**
 * Appointments table
 */
export const appointments = mysqlTable("appointments", {
  id: int("id").autoincrement().primaryKey(),
  clinicId: int("clinicId").notNull(),
  patientId: int("patientId").notNull(),
  appointmentDate: datetime("appointmentDate").notNull(),
  duration: int("duration").default(30), // in minutes
  reason: text("reason"),
  notes: text("notes"),
  assignedDoctor: int("assignedDoctor"),
  status: mysqlEnum("status", ["scheduled", "confirmed", "completed", "cancelled", "no_show"]).default("scheduled"),
  reminderSent: boolean("reminderSent").default(false),
  reminderSentDate: timestamp("reminderSentDate"),
  clientMutationId: varchar("clientMutationId", { length: 36 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  clientMutationIdUnique: uniqueIndex("appointments_clientMutationId_unique").on(table.clientMutationId),
}));

export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = typeof appointments.$inferInsert;

/**
 * SMS notifications log
 */
export const smsNotifications = mysqlTable("smsNotifications", {
  id: int("id").autoincrement().primaryKey(),
  clinicId: int("clinicId").notNull(),
  recipientPhone: varchar("recipientPhone", { length: 20 }).notNull(),
  recipientType: mysqlEnum("recipientType", ["patient", "staff", "manager"]).notNull(),
  messageType: mysqlEnum("messageType", ["appointment_reminder", "payment_receipt", "payment_reminder", "low_stock_alert", "visit_confirmation"]).notNull(),
  messageContent: text("messageContent").notNull(),
  appointmentId: int("appointmentId"),
  billId: int("billId"),
  drugId: int("drugId"),
  status: mysqlEnum("status", ["pending", "sent", "failed"]).default("pending"),
  sentDate: timestamp("sentDate"),
  failureReason: text("failureReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SmsNotification = typeof smsNotifications.$inferSelect;
export type InsertSmsNotification = typeof smsNotifications.$inferInsert;

/**
 * Activity audit log
 */
export const activityLog = mysqlTable("activityLog", {
  id: int("id").autoincrement().primaryKey(),
  clinicId: int("clinicId").notNull(),
  userId: int("userId").notNull(),
  action: varchar("action", { length: 255 }).notNull(),
  entityType: varchar("entityType", { length: 100 }),
  entityId: int("entityId"),
  changes: text("changes"), // JSON
  ipAddress: varchar("ipAddress", { length: 45 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ActivityLog = typeof activityLog.$inferSelect;

/**
 * Subscription lifecycle events — written by the LemonSqueezy webhook
 * handler for every upgrade/downgrade/cancellation, and also used to flag
 * edge cases (e.g. an unrecognised variant_id) that previously only went to
 * console.error and were invisible unless someone was tailing Render logs
 * at that exact moment. Powers both the Owner Dashboard's churn stats
 * (query eventType) and its "needs attention" panel (query needsReview).
 */
export const subscriptionEvents = mysqlTable("subscriptionEvents", {
  id: int("id").autoincrement().primaryKey(),
  clinicId: int("clinicId").notNull(),
  eventType: mysqlEnum("eventType", ["upgraded", "downgraded", "cancelled", "payment_failed", "needs_review"]).notNull(),
  fromTier: varchar("fromTier", { length: 20 }),
  toTier: varchar("toTier", { length: 20 }),
  note: text("note"),
  needsReview: boolean("needsReview").default(false).notNull(),
  resolvedAt: timestamp("resolvedAt"),
  resolvedByUserId: int("resolvedByUserId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect;
export type InsertSubscriptionEvent = typeof subscriptionEvents.$inferInsert;
export type InsertActivityLog = typeof activityLog.$inferInsert;

/**
 * Staff invites - lets a manager invite a doctor/receptionist to join their
 * clinic via a tokenized link sent by SMS or email. (Phase 3 builds the
 * tRPC procedures and UI on top of this table.)
 */
export const invites = mysqlTable("invites", {
  id: int("id").autoincrement().primaryKey(),
  clinicId: int("clinicId").notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }),
  role: mysqlEnum("role", ["receptionist", "doctor", "manager"]).notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  invitedBy: int("invitedBy").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Invite = typeof invites.$inferSelect;
export type InsertInvite = typeof invites.$inferInsert;

/**
 * OTP codes for phone-number login via Africa's Talking SMS.
 * The code is stored as a hash (not plaintext) and is single-use.
 */
export const otpCodes = mysqlTable("otpCodes", {
  id: int("id").autoincrement().primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  codeHash: varchar("codeHash", { length: 255 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  attempts: int("attempts").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OtpCode = typeof otpCodes.$inferSelect;

/**
 * Service templates - manager-defined common services with standard prices.
 * Billing clerk picks from the list instead of typing amounts every time.
 */
export const serviceTemplates = mysqlTable("serviceTemplates", {
  id: int("id").autoincrement().primaryKey(),
  clinicId: int("clinicId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  category: mysqlEnum("category", ["consultation", "lab", "drug", "other"]).default("other").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ServiceTemplate = typeof serviceTemplates.$inferSelect;
export type InsertServiceTemplate = typeof serviceTemplates.$inferInsert;
