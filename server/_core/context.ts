import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { Clinic, User } from "../../drizzle/schema";
import { authenticateRequest } from "../auth";
import { getClinicById } from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: (User & { impersonatedBy?: number }) | null;
  clinic: Clinic | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: (User & { impersonatedBy?: number }) | null = null;

  try {
    user = await authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  let clinic: Clinic | null = null;
  if (user?.clinicId) {
    try {
      clinic = (await getClinicById(user.clinicId)) ?? null;
    } catch (error) {
      clinic = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    clinic,
  };
}
