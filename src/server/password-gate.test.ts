import { describe, it, expect } from "vitest";
import {
  accountOfActor,
  addAccount,
  changePassword,
  findAccount,
  isTemporaryPasswordExpired,
  resetPassword,
  verifyCredentials,
} from "./accounts";
import {
  assignableRoles,
  canAddPeople,
  canAssignRole,
  TEMPORARY_PASSWORD_DAYS,
} from "./roles";

/**
 * The forced-password-change gate.
 *
 * The account row — not the session token — is the source of truth. A token is
 * a snapshot from sign-in; an admin reset after that must still bite, which is
 * why `getActingUser()` in session-guard.ts reads the account and why
 * `/api/operations` uses it rather than `getSessionUser()`.
 */

describe("temporary passwords", () => {
  it("a newly created account must set its own password first", async () => {
    const created = await addAccount({
      username: "newjoiner",
      password: "handed-over-by-admin",
      displayName: "New Joiner",
      role: "employee",
    });
    expect(created.ok).toBe(true);

    // The password the admin typed works exactly once, to get in and replace it.
    const firstSignIn = verifyCredentials("newjoiner", "handed-over-by-admin");
    expect(firstSignIn?.mustChangePassword).toBe(true);

    await changePassword("newjoiner", "handed-over-by-admin", "my-own-password");
    expect(verifyCredentials("newjoiner", "my-own-password")?.mustChangePassword).toBe(false);
    // The admin's value is now useless.
    expect(verifyCredentials("newjoiner", "handed-over-by-admin")).toBeNull();
  });

  it("an admin reset forces the holder to choose a new password", async () => {
    // Baseline: a seeded demo account is usable as-is.
    expect(verifyCredentials("employee", "employee123")?.mustChangePassword).toBe(false);

    const reset = await resetPassword("employee", "temp-pass-123");
    expect(reset.ok).toBe(true);

    const signedIn = verifyCredentials("employee", "temp-pass-123");
    expect(signedIn).not.toBeNull();
    expect(signedIn?.mustChangePassword).toBe(true);
    expect(accountOfActor("priya")?.mustChangePassword).toBe(true);
  });

  it("changing your own password clears the flag", async () => {
    await resetPassword("manager", "temp-pass-456");
    expect(findAccount("manager")?.mustChangePassword).toBe(true);

    const changed = await changePassword("manager", "temp-pass-456", "chosen-by-me");
    expect(changed.ok).toBe(true);
    expect(findAccount("manager")?.mustChangePassword).toBe(false);
    expect(verifyCredentials("manager", "chosen-by-me")?.mustChangePassword).toBe(false);
  });

  it("a failed change leaves the flag set", async () => {
    await resetPassword("intern", "temp-pass-789");
    const wrongCurrent = await changePassword("intern", "not-the-temp", "whatever-123");
    expect(wrongCurrent.ok).toBe(false);
    expect(findAccount("intern")?.mustChangePassword).toBe(true);

    const tooShort = await changePassword("intern", "temp-pass-789", "abc");
    expect(tooShort.ok).toBe(false);
    expect(findAccount("intern")?.mustChangePassword).toBe(true);
  });

  it("a temporary password stops working after a week", async () => {
    await addAccount({
      username: "neverloggedin",
      password: "handed-over",
      displayName: "Never Logged In",
      role: "employee",
    });
    const account = findAccount("neverloggedin")!;
    expect(account.temporaryPasswordExpiresAt).toBeDefined();

    const day = 24 * 60 * 60 * 1000;
    const issued = new Date(account.temporaryPasswordExpiresAt!).getTime() -
      TEMPORARY_PASSWORD_DAYS * day;

    expect(isTemporaryPasswordExpired(account, new Date(issued + 6 * day))).toBe(false);
    expect(isTemporaryPasswordExpired(account, new Date(issued + 8 * day))).toBe(true);
  });

  it("a password the holder chose never expires", async () => {
    await addAccount({
      username: "settled",
      password: "handed-over",
      displayName: "Settled",
      role: "employee",
    });
    await changePassword("settled", "handed-over", "chosen-by-me");
    const account = findAccount("settled")!;
    expect(account.mustChangePassword).toBe(false);
    expect(account.temporaryPasswordExpiresAt).toBeUndefined();
    // Ten years on, still fine.
    const farFuture = new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000);
    expect(isTemporaryPasswordExpired(account, farFuture)).toBe(false);
  });

  it("a reset restarts the clock", async () => {
    await resetPassword("employee", "second-temp-pass");
    const account = findAccount("employee")!;
    expect(account.temporaryPasswordExpiresAt).toBeDefined();
    expect(new Date(account.temporaryPasswordExpiresAt!).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("the flag lives on the account, so it is visible however the session was issued", async () => {
    await resetPassword("hr", "temp-pass-000");
    // A session token minted *before* the reset would still say false. Reading
    // the account is what makes the reset take effect immediately.
    expect(accountOfActor("shruti")?.mustChangePassword).toBe(true);

    await changePassword("hr", "temp-pass-000", "shruti-new-pass");
    expect(accountOfActor("shruti")?.mustChangePassword).toBe(false);
  });
});

/**
 * Who may add a person, and what role they may hand out.
 *
 * The ladder exists because managers can now add people. Without it, a manager
 * could create an admin login and sign into it — privilege escalation in one
 * step, from a feature that sounds harmless.
 */
describe("role ladder for adding people", () => {
  it("HR, managers and admins can add people; employees and interns cannot", () => {
    expect(canAddPeople("super-admin")).toBe(true);
    expect(canAddPeople("admin")).toBe(true);
    expect(canAddPeople("hr")).toBe(true);
    expect(canAddPeople("manager")).toBe(true);
    expect(canAddPeople("employee")).toBe(false);
    expect(canAddPeople("intern")).toBe(false);
    expect(canAddPeople(undefined)).toBe(false);
  });

  it("nobody can create a role above their own", () => {
    expect(canAssignRole("manager", "admin")).toBe(false);
    expect(canAssignRole("manager", "hr")).toBe(false);
    expect(canAssignRole("manager", "manager")).toBe(false);
    expect(canAssignRole("hr", "admin")).toBe(false);
    expect(canAssignRole("hr", "super-admin")).toBe(false);
    expect(canAssignRole("admin", "super-admin")).toBe(false);
    expect(canAssignRole("admin", "admin")).toBe(false);
  });

  it("each role can create the ones below it", () => {
    expect(canAssignRole("manager", "employee")).toBe(true);
    expect(canAssignRole("manager", "intern")).toBe(true);
    expect(canAssignRole("hr", "manager")).toBe(true);
    expect(canAssignRole("admin", "hr")).toBe(true);
    expect(canAssignRole("super-admin", "admin")).toBe(true);
  });

  it("only a super-admin can mint an admin", () => {
    const minters = ["super-admin", "admin", "hr", "manager", "employee", "intern"]
      .filter((r) => canAssignRole(r, "admin"));
    expect(minters).toEqual(["super-admin"]);
  });

  it("an unknown role can do nothing", () => {
    expect(assignableRoles("finance")).toEqual([]);
    expect(canAddPeople("finance")).toBe(false);
  });
});
