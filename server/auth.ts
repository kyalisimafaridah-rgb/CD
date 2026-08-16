// Self-contained email/password + phone/OTP authentication.
//
// Phase 4 additions:
//  - sessionVersion embedded in JWT — bumped on every new login,
//    so old tokens from previous devices are rejected without a DB
//    round-trip per request (authenticateRequest checks the version
//    embedded in the token against the stored one before loading the user)
//  - rememberMe flag: short (1-day) vs long (365-day) expiry cookie
//  - lockout check helpers consumed by the auth.login tRPC mutation

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
import type { Request, Response } from "express";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { User } from "../drizzle/schema";
import * as db from "./db";
import { ENV } from "./_core/env";
import { getSessionCookieOptions } from "./_core/cookies";

const scrypt = promisify(scryptCallback);
const SCRYPT_KEYLEN = 64;

export const SESSION_SHORT_MS = 24 * 60 * 60 * 1000;          // 1 day (not remembered)
export const SESSION_LONG_MS  = ONE_YEAR_MS;                    // 365 days (remembered)
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;             // 15 minutes

/**
 * Hashes a plaintext password using scrypt with a random salt.
 * Stored format: "<salt-hex>:<derivedKey-hex>"
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

/**
 * Verifies a plaintext password against a stored "<salt>:<hash>" string
 * using a constant-time comparison.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;

  const keyBuffer = Buffer.from(key, "hex");
  const derivedKey = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;

  if (derivedKey.length !== keyBuffer.length) return false;
  return timingSafeEqual(derivedKey, keyBuffer);
}

function getSessionSecret(): Uint8Array {
  return new TextEncoder().encode(ENV.cookieSecret);
}

/**
 * Creates a signed session JWT containing the user's id and the current
 * sessionVersion. The version allows immediate invalidation of all other
 * sessions without a separate token-blocklist or DB lookup per request.
 * impersonatedBy carries the original admin's userId when impersonating.
 */
export async function createSessionToken(
  userId: number,
  sessionVersion: number,
  expiresInMs: number = SESSION_LONG_MS,
  impersonatedBy?: number,
): Promise<string> {
  const expirationSeconds = Math.floor((Date.now() + expiresInMs) / 1000);
  const payload: Record<string, unknown> = { userId, sv: sessionVersion };
  if (impersonatedBy !== undefined) payload.impersonatedBy = impersonatedBy;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(expirationSeconds)
    .sign(getSessionSecret());
}

/**
 * Verifies a session JWT and returns the embedded payload, or null if the
 * token is missing, expired, or invalid.
 */
export async function verifySessionToken(
  token: string | undefined | null
): Promise<{ userId: number; sv: number; impersonatedBy?: number } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), { algorithms: ["HS256"] });
    const userId = payload.userId;
    const sv = payload.sv;
    if (typeof userId !== "number" || typeof sv !== "number") return null;
    const impersonatedBy = typeof payload.impersonatedBy === "number" ? payload.impersonatedBy : undefined;
    return { userId, sv, impersonatedBy };
  } catch {
    return null;
  }
}

/**
 * Bumps the user's sessionVersion in the DB, signs a new JWT containing
 * the bumped version (invalidating all previously issued tokens), and sets
 * the session cookie. rememberMe=true → 365-day expiry, false → 1-day.
 * impersonatedBy should be set to the admin's userId when impersonating.
 */
export async function setSessionCookie(
  req: Request,
  res: Response,
  userId: number,
  rememberMe = true,
  impersonatedBy?: number,
): Promise<void> {
  const newVersion = await db.bumpSessionVersion(userId);
  const expiresInMs = rememberMe ? SESSION_LONG_MS : SESSION_SHORT_MS;
  const token = await createSessionToken(userId, newVersion, expiresInMs, impersonatedBy);
  const cookieOptions = getSessionCookieOptions(req);
  res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: expiresInMs });
}

function readSessionCookie(req: Request): string | undefined {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  return cookies[COOKIE_NAME];
}

/**
 * Reads the session cookie from an incoming request, verifies the JWT,
 * checks the embedded sessionVersion against the stored value (rejects
 * stale tokens from previous sessions), and loads the user.
 *
 * Returns null if there's no valid session, the user no longer exists,
 * the account has been deactivated, or the session version doesn't match
 * (i.e. a newer login has since been issued from another device).
 */
export async function authenticateRequest(req: Request): Promise<(User & { impersonatedBy?: number }) | null> {
  const token = readSessionCookie(req);
  const session = await verifySessionToken(token);
  if (!session) return null;

  const user = await db.getUserById(session.userId);
  if (!user || !user.isActive) return null;

  // Reject tokens issued before the latest login (single active session).
  // sessionVersion is bumped on every setSessionCookie call, so a token
  // with an older 'sv' means the user has since logged in from another
  // device/browser and the old session is now invalid.
  if (session.sv !== user.sessionVersion) return null;

  if (session.impersonatedBy !== undefined) {
    return { ...user, impersonatedBy: session.impersonatedBy };
  }
  return user;
}
