import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";

export type { RbacRole } from "@/domains/shared/people-roster";
export { RBAC_ROLES } from "@/domains/shared/people-roster";
import type { RbacRole } from "@/domains/shared/people-roster";
export { SESSION_COOKIE } from "./auth-constants";
import { SESSION_COOKIE } from "./auth-constants";
import { env } from "@/config/env";

export interface AuthUser {
  id: string;
  username: string;
  role: RbacRole;
  displayName: string;
}

export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function secret(): string {
  return env().authSecret;
}

export function createSessionToken(user: AuthUser): string {
  const payload = Buffer.from(
    JSON.stringify({ ...user, exp: Date.now() + SESSION_MAX_AGE * 1000 }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function readSessionToken(token: string | undefined): AuthUser | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      id: string;
      username: string;
      role: RbacRole;
      displayName: string;
      exp?: number;
    };
    if (typeof data.exp === "number" && Date.now() > data.exp) return null;
    return {
      id: data.id,
      username: data.username,
      role: data.role,
      displayName: data.displayName,
    };
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  const real = Buffer.from(hash, "hex");
  if (test.length !== real.length) return false;
  return timingSafeEqual(test, real);
}

export async function getSessionUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return readSessionToken(token);
}

export async function requireSessionUser(): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new UnauthenticatedError();
  }
  return user;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthenticatedError";
  }
}
