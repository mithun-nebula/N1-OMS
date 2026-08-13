import { getSessionUser, type AuthUser } from "./auth";
import { accountOfActor } from "./accounts";
import { ensureAccountsReady } from "./runtime";

/**
 * Session helpers that consult the **account**, not just the session token.
 *
 * The token is a snapshot taken at sign-in. `mustChangePassword` can change
 * after that — an admin resetting someone's password is exactly the case where
 * you want the change to bite immediately, and a token issued an hour earlier
 * still says `false`. So anything enforcing the gate must read the account.
 *
 * Middleware cannot use this: it runs on the Edge runtime, where neither the
 * database nor `node:crypto` is available. Its cookie check is a fast redirect
 * hint only — see `src/middleware.ts`. **This module is the enforcement.**
 *
 * Single-instance assumption: `accountOfActor` reads the in-memory map that is
 * hydrated from Postgres at boot and written through on every mutation. Another
 * instance's reset would not be visible until this one restarts. Fine for one
 * process; revisit when running more than one.
 */

export type ActingUser =
  | { ok: true; user: AuthUser }
  | { ok: false; status: 401 | 403; error: string };

/** The signed-in user, with `mustChangePassword` taken from the live account. */
export async function getLiveSessionUser(): Promise<AuthUser | null> {
  const user = await getSessionUser();
  if (!user) return null;
  await ensureAccountsReady();
  const account = accountOfActor(user.id);
  return {
    ...user,
    // The account wins when there is one. Falling back to the token covers
    // accounts that exist only in the token's lifetime (none today).
    mustChangePassword: account
      ? account.mustChangePassword === true
      : user.mustChangePassword === true,
  };
}

/**
 * For any route that lets someone *act*. Refuses while a temporary password is
 * still in place, so bypassing the middleware redirect gains nothing.
 */
export async function getActingUser(): Promise<ActingUser> {
  const user = await getLiveSessionUser();
  if (!user) {
    return { ok: false, status: 401, error: "Not authenticated." };
  }
  if (user.mustChangePassword) {
    return {
      ok: false,
      status: 403,
      error: "Set a new password before continuing.",
    };
  }
  return { ok: true, user };
}
