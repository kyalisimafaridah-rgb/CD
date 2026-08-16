import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  timestamp,
  varchar,
  decimal,
  date,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Enums (Postgres requires named types) ───────────────────────────────────

export const userRoleEnum = pgEnum("user_role", [
  "receptionist",
  "doctor",
  "manager",
  "admin",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "inactive",
  "suspended",
]);

export const subscriptionTierEnum = pgEnum("subscription_tier", [
  "free",
  "clinic",
  "pro",
]);

export const genderEnum = pgEnum("gender", ["male", "female", "other"]);

export const visitStatusEnum = pgEnum("visit_status", [
  "pending",
  "open",
  "in_progress",
  "completed",
  "cancelled",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "unpaid",
  "partial",
  "paid",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "mtn_momo",
  "bank_transfer",
  "cheque",
]);

export const paymentTxnStatusEnum = pgEnum("payment_txn_status", [
  "pending",
  "confirmed",
  "failed",
]);

export const stockTxnTypeEnum = pgEnum("stock_txn_type", [
  "add",
  "deduct",
  "restock",
  "adjustment",
]);

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
]);

export const smsRecipientTypeEnum = pgEnum("sms_recipient_type", [
  "patient",
  "staff",
  "manager",
]);

export const smsMessageTypeEnum = pgEnum("sms_message_type", [
  "appointment_reminder",
  "payment_receipt",
  "payment_reminder",
  "low_stock_alert",
  "visit_confirmation",
]);

export const smsStatusEnum = pgEnum("sms_status", [
  "pending",
  "sent",
  "failed",
]);

export const subscriptionEventTypeEnum = pgEnum("subscription_event_type", [
  "upgraded",
  "downgraded",
  "cancelled",
  "payment_failed",
  "needs_review",
]);

export const inviteRoleEnum = pgEnum("invite_role", [
  "receptionist",
  "doctor",
  "manager",
]);

export const serviceCategoryEnum = pgEnum("service_category", [
  "consultation",
  "lab",
  "drug",
  "other",
]);

// ─── Tables ──────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }).unique(),
  phone: varchar("phone", { length: 20 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  role: userRoleEnum("role").default("receptionist").notNull(),
  clinicId: integer("clinicId"),
  isActive: boolean("isActive").default(true).notNull(),
  sessionVersion: integer("sessionVersion").default(0).notNull(),
  failedLoginAttempts: integer("failedLoginAttempts").default(0).notNull(),
  lockedUntil: timestamp("lockedUntil"),
  passwordResetToken: varchar("passwordResetToken", { length: 64 }),
  passwordResetExpiresAt: timestamp("passwordResetExpiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const clinics = pgTable("clinics", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  registrationNumber: varchar("registrationNumber", { length: 100 }),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  country: varchar("country", { length: 100 }).default("Uganda"),
  ownerId: integer("ownerId"),
  consultationFee: decimal("consultationFee", { precision: 10, scale: 2 }).default("0"),
  mtnMomoNumber: varchar("mtnMomoNumber", { length: 20 }),
  subscriptionStatus: subscriptionStatusEnum("subscriptionStatus").default("active"),
  subscriptionTier: subscriptionTierEnum("subscriptionTier").default("free"),
  trialEndsAt: timestamp("trialEndsAt"),
  gracePeriodEndsAt: timestamp("gracePeriodEndsAt"),
  lsCustomerId: varchar("lsCustomerId", { length: 100 }),
  lsSubscriptionId: varchar("lsSubscriptionId", { length: 100 }),
  subscriptionRenewsAt: timestamp("subscriptionRenewsAt"),
  lastBackupDate: timestamp("lastBackupDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type Clinic = typeof clinics.$inferSelect;
export type InsertClinic = typeof clinics.$inferInsert;

export const patients = pgTable(
  "patients",
  {
    id: serial("id").primaryKey(),
    clinicId: integer("clinicId").notNull(),
    patientId: varchar("patientId", { length: 20 }).notNull(),
    firstName: varchar("firstName", { length: 100 }).notNull(),
    lastName: varchar("lastName", { length: 100 }),
    dateOfBirth: date("dateOfBirth"),
    age: integer("age"),
    gender: genderEnum("gender"),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 320 }),
    village: varchar("village", { length: 100 }),
    nextOfKin: varchar("nextOfKin", { length: 255 }),
    nextOfKinPhone: varchar("nextOfKinPhone", { length: 20 }),
    photoUrl: text("photoUrl"),
    medicalHistory: text("medicalHistory"),
    allergies: text("allergies"),
    flags: varchar("flags", { length: 255 }),
    smsOptOut: boolean("smsOptOut").default(false).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    clientMutationId: varchar("clientMutationId", { length: 36 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    clinicPatientIdUnique: uniqueIndex("patients_clinicId_patientId_unique").on(table.clinicId, table.patientId),
    clientMutationIdUnique: uniqueIndex("patients_clientMutationId_unique").on(table.clientMutationId),
  })
);

export type Patient = typeof patients.$inferSelect;
export type InsertPatient = typeof patients.$inferInsert;

export const visits = pgTable(
  "visits",
  {
    id: serial("id").primaryKey(),
    clinicId: integer("clinicId").notNull(),
    patientId: integer("patientId").notNull(),
    visitDate: timestamp("visitDate").notNull(),
    chiefComplaint: text("chiefComplaint"),
    clinicalNotes: text("clinicalNotes"),
    diagnosis: text("diagnosis"),
    consultationFee: decimal("consultationFee", { precision: 10, scale: 2 }).notNull(),
    doctorId: integer("doctorId"),
    receptionistId: integer("receptionistId"),
    status: visitStatusEnum("status").default("completed"),
    prescriptionNotes: text("prescriptionNotes"),
    followUpFlag: boolean("followUpFlag").default(false).notNull(),
    followUpDate: date("followUpDate"),
    clientMutationId: varchar("clientMutationId", { length: 36 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    clientMutationIdUnique: uniqueIndex("visits_clientMutationId_unique").on(table.clientMutationId),
  })
);

export type Visit = typeof visits.$inferSelect;
export type InsertVisit = typeof visits.$inferInsert;

export const labTests = pgTable("labTests", {
  id: serial("id").primaryKey(),
  visitId: integer("visitId").notNull(),
  testName: varchar("testName", { length: 255 }).notNull(),
  cost: decimal("cost", { precision: 10, scale: 2 }).notNull(),
  result: text("result"),
  resultDate: timestamp("resultDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LabTest = typeof labTests.$inferSelect;
export type InsertLabTest = typeof labTests.$inferInsert;

export const prescribedDrugs = pgTable("prescribedDrugs", {
  id: serial("id").primaryKey(),
  visitId: integer("visitId").notNull(),
  drugId: integer("drugId"),
  drugName: varchar("drugName", { length: 255 }).notNull(),
  dosage: varchar("dosage", { length: 100 }),
  quantity: integer("quantity").notNull(),
  unit: varchar("unit", { length: 50 }),
  costPerUnit: decimal("costPerUnit", { precision: 10, scale: 2 }).notNull(),
  totalCost: decimal("totalCost", { precision: 10, scale: 2 }).notNull(),
  instructions: text("instructions"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PrescribedDrug = typeof prescribedDrugs.$inferSelect;
export type InsertPrescribedDrug = typeof prescribedDrugs.$inferInsert;

export const bills = pgTable(
  "bills",
  {
    id: serial("id").primaryKey(),
    clinicId: integer("clinicId").notNull(),
    patientId: integer("patientId").notNull(),
    visitId: integer("visitId").notNull(),
    billNumber: varchar("billNumber", { length: 50 }).notNull(),
    consultationFee: decimal("consultationFee", { precision: 10, scale: 2 }).notNull(),
    labTotal: decimal("labTotal", { precision: 10, scale: 2 }).default("0"),
    drugTotal: decimal("drugTotal", { precision: 10, scale: 2 }).default("0"),
    grandTotal: decimal("grandTotal", { precision: 10, scale: 2 }).notNull(),
    amountPaid: decimal("amountPaid", { precision: 10, scale: 2 }).default("0"),
    balanceAmount: decimal("balanceAmount", { precision: 10, scale: 2 }).notNull(),
    paymentStatus: paymentStatusEnum("paymentStatus").default("unpaid"),
    paymentMethod: paymentMethodEnum("paymentMethod"),
    isVoided: boolean("isVoided").default(false).notNull(),
    billDate: timestamp("billDate").notNull(),
    dueDate: timestamp("dueDate"),
    paidDate: timestamp("paidDate"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    clinicBillNumberUnique: uniqueIndex("bills_clinicId_billNumber_unique").on(table.clinicId, table.billNumber),
  })
);

export type Bill = typeof bills.$inferSelect;
export type InsertBill = typeof bills.$inferInsert;

export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    billId: integer("billId").notNull(),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    paymentMethod: paymentMethodEnum("paymentMethod").notNull(),
    paymentDate: timestamp("paymentDate").notNull(),
    transactionId: varchar("transactionId", { length: 100 }),
    status: paymentTxnStatusEnum("status").default("pending"),
    notes: text("notes"),
    clientMutationId: varchar("clientMutationId", { length: 36 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    clientMutationIdUnique: uniqueIndex("payments_clientMutationId_unique").on(table.clientMutationId),
  })
);

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

export const drugs = pgTable("drugs", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinicId").notNull(),
  drugName: varchar("drugName", { length: 255 }).notNull(),
  genericName: varchar("genericName", { length: 255 }),
  quantity: integer("quantity").notNull(),
  unit: varchar("unit", { length: 50 }).notNull(),
  costPerUnit: decimal("costPerUnit", { precision: 10, scale: 2 }).notNull(),
  sellingPrice: decimal("sellingPrice", { precision: 10, scale: 2 }).notNull(),
  lowStockThreshold: integer("lowStockThreshold").notNull(),
  expiryDate: date("expiryDate"),
  batchNumber: varchar("batchNumber", { length: 100 }),
  supplier: varchar("supplier", { length: 255 }),
  lastRestockDate: timestamp("lastRestockDate"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type Drug = typeof drugs.$inferSelect;
export type InsertDrug = typeof drugs.$inferInsert;

export const drugStockHistory = pgTable("drugStockHistory", {
  id: serial("id").primaryKey(),
  drugId: integer("drugId").notNull(),
  transactionType: stockTxnTypeEnum("transactionType").notNull(),
  quantityChanged: integer("quantityChanged").notNull(),
  previousQuantity: integer("previousQuantity").notNull(),
  newQuantity: integer("newQuantity").notNull(),
  reason: text("reason"),
  userId: integer("userId"),
  visitId: integer("visitId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DrugStockHistory = typeof drugStockHistory.$inferSelect;
export type InsertDrugStockHistory = typeof drugStockHistory.$inferInsert;

export const appointments = pgTable(
  "appointments",
  {
    id: serial("id").primaryKey(),
    clinicId: integer("clinicId").notNull(),
    patientId: integer("patientId").notNull(),
    appointmentDate: timestamp("appointmentDate").notNull(),
    duration: integer("duration").default(30),
    reason: text("reason"),
    notes: text("notes"),
    assignedDoctor: integer("assignedDoctor"),
    status: appointmentStatusEnum("status").default("scheduled"),
    reminderSent: boolean("reminderSent").default(false),
    reminderSentDate: timestamp("reminderSentDate"),
    clientMutationId: varchar("clientMutationId", { length: 36 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    clientMutationIdUnique: uniqueIndex("appointments_clientMutationId_unique").on(table.clientMutationId),
  })
);

export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = typeof appointments.$inferInsert;

export const smsNotifications = pgTable("smsNotifications", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinicId").notNull(),
  recipientPhone: varchar("recipientPhone", { length: 20 }).notNull(),
  recipientType: smsRecipientTypeEnum("recipientType").notNull(),
  messageType: smsMessageTypeEnum("messageType").notNull(),
  messageContent: text("messageContent").notNull(),
  appointmentId: integer("appointmentId"),
  billId: integer("billId"),
  drugId: integer("drugId"),
  status: smsStatusEnum("status").default("pending"),
  sentDate: timestamp("sentDate"),
  failureReason: text("failureReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SmsNotification = typeof smsNotifications.$inferSelect;
export type InsertSmsNotification = typeof smsNotifications.$inferInsert;

export const activityLog = pgTable("activityLog", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinicId").notNull(),
  userId: integer("userId").notNull(),
  action: varchar("action", { length: 255 }).notNull(),
  entityType: varchar("entityType", { length: 100 }),
  entityId: integer("entityId"),
  changes: text("changes"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ActivityLog = typeof activityLog.$inferSelect;
export type InsertActivityLog = typeof activityLog.$inferInsert;

export const subscriptionEvents = pgTable("subscriptionEvents", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinicId").notNull(),
  eventType: subscriptionEventTypeEnum("eventType").notNull(),
  fromTier: varchar("fromTier", { length: 20 }),
  toTier: varchar("toTier", { length: 20 }),
  note: text("note"),
  needsReview: boolean("needsReview").default(false).notNull(),
  resolvedAt: timestamp("resolvedAt"),
  resolvedByUserId: integer("resolvedByUserId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect;
export type InsertSubscriptionEvent = typeof subscriptionEvents.$inferInsert;

export const invites = pgTable("invites", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinicId").notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }),
  role: inviteRoleEnum("role").notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  invitedBy: integer("invitedBy").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Invite = typeof invites.$inferSelect;
export type InsertInvite = typeof invites.$inferInsert;

export const otpCodes = pgTable("otpCodes", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  codeHash: varchar("codeHash", { length: 255 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  attempts: integer("attempts").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OtpCode = typeof otpCodes.$inferSelect;

export const serviceTemplates = pgTable("serviceTemplates", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinicId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  category: serviceCategoryEnum("category").default("other").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ServiceTemplate = typeof serviceTemplates.$inferSelect;
export type InsertServiceTemplate = typeof serviceTemplates.$inferInsert;
