import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryActivityLog } from "@/spine/activity-log/log";
import type { ActivityEntry } from "@/spine/activity-log/types";
import {
  configureAccounts,
  addAccount,
  addAccountForPerson,
  removeAccount,
  setAccountEnabled,
  updateRole,
  changePassword,
  resetPassword,
} from "./accounts";

/**
 * Accounts decide who can sign in and what they may do, and none of these
 * seven writes left a trace — `log.append` existed only in `spine.ts`. So
 * granting somebody the admin role, or resetting their password, was
 * unrecordable. `CONTEXT.md` §13 #1 says permission *and the activity log*
 * live at the gate; for the most sensitive writes in the system, the second
 * half was false.
 *
 * These tests hold the three things that matter: an entry is written, it names
 * the actor, and it never contains a password.
 */

let log: InMemoryActivityLog;

beforeEach(async () => {
  log = new InMemoryActivityLog();
  // No pool: in-memory accounts, and the log wired in the way bootstrap does.
  await configureAccounts(undefined, log);
});

async function entries(): Promise<ActivityEntry[]> {
  return log.query();
}

const PASSWORDS = [
  "handed-over-by-admin",
  "chosen-by-me",
  "temp-from-admin",
  "a-fresh-temp-pass",
];

/** Nothing secret may survive into the log, in any field, at any depth. */
function assertNoSecrets(all: ActivityEntry[]): void {
  const serialised = JSON.stringify(all);
  for (const secret of PASSWORDS) {
    expect(serialised).not.toContain(secret);
  }
  // Nor the hash of one: the hashes are hex/base64-ish blobs, so assert the
  // field itself never appears rather than trying to recognise a value.
  expect(serialised).not.toContain("passwordHash");
  expect(serialised).not.toContain("temporaryPassword\"");
}

describe("account changes are recorded", () => {
  it("a role change is logged, and names the admin who made it", async () => {
    await addAccount({
      username: "logged-a",
      password: "handed-over-by-admin",
      displayName: "Logged A",
      role: "employee",
      actor: "admin",
    });

    await updateRole("logged-a", "manager", "shruti");

    const roleChanges = (await entries()).filter(
      (e) => e.operationName === "account.updateRole",
    );
    expect(roleChanges).toHaveLength(1);
    const entry = roleChanges[0];
    expect(entry.actor).toBe("shruti");
    expect(entry.authority).toEqual({ kind: "self", actor: "shruti" });
    expect(entry.outcome).toBe("ran");
    expect(entry.changes[0]).toMatchObject({
      nodeType: "account",
      nodeId: "logged-a",
      before: { role: "employee" },
      after: { role: "manager" },
    });
  });

  it("carries no undo — there is no safe automatic undo for granting admin", async () => {
    await addAccount({
      username: "logged-b",
      password: "handed-over-by-admin",
      displayName: "Logged B",
      role: "employee",
      actor: "admin",
    });
    await updateRole("logged-b", "admin", "superadmin");

    for (const entry of await entries()) {
      expect(entry.undoPlan).toBeUndefined();
      expect(entry.undoDescription).toBeUndefined();
    }
  });

  it("all seven mutations write an entry, and every one names its actor", async () => {
    await addAccount({
      username: "seven-a",
      password: "handed-over-by-admin",
      displayName: "Seven A",
      role: "employee",
      actor: "admin",
    });
    await addAccountForPerson({
      personId: "seven-b",
      username: "seven-b",
      temporaryPassword: "temp-from-admin",
      displayName: "Seven B",
      role: "employee",
      actor: "shruti",
    });
    await changePassword("seven-a", "handed-over-by-admin", "chosen-by-me", "seven-a");
    await resetPassword("seven-a", "a-fresh-temp-pass", "admin");
    await updateRole("seven-a", "manager", "admin");
    await setAccountEnabled("seven-b", false, "shruti");
    await removeAccount("seven-b", "admin");

    const all = await entries();
    const names = all.map((e) => e.operationName);
    expect(new Set(names)).toEqual(
      new Set([
        "account.add",
        "account.addForPerson",
        "account.changePassword",
        "account.resetPassword",
        "account.updateRole",
        "account.setEnabled",
        "account.remove",
      ]),
    );
    // An entry attributing an admin's action to nobody looks like a record and
    // is not one, so this is the assertion that matters most.
    for (const entry of all) {
      expect(entry.actor).toBeTruthy();
      expect(entry.startedBy.actor).toBe(entry.actor);
      expect(entry.at).toBeTruthy();
    }
    assertNoSecrets(all);
  });

  it("never records a password, a hash, or a temporary password", async () => {
    await addAccount({
      username: "secret-a",
      password: "handed-over-by-admin",
      displayName: "Secret A",
      role: "employee",
      actor: "admin",
    });
    await changePassword("secret-a", "handed-over-by-admin", "chosen-by-me", "secret-a");
    await resetPassword("secret-a", "a-fresh-temp-pass", "admin");

    const all = await entries();
    assertNoSecrets(all);

    // What IS recorded is that it changed.
    const changed = all.find((e) => e.operationName === "account.changePassword");
    expect(changed?.changes[0].after).toMatchObject({ passwordChanged: true });
    const reset = all.find((e) => e.operationName === "account.resetPassword");
    expect(reset?.changes[0].after).toMatchObject({ passwordReset: true });
  });

  it("records nothing when nothing changed", async () => {
    await removeAccount("no-such-account", "admin");
    await setAccountEnabled("no-such-person", false, "admin");
    await updateRole("no-such-account", "admin", "admin");
    expect(await entries()).toHaveLength(0);
  });

  it("without a log, every mutation still works — the parameter is optional", async () => {
    await configureAccounts(undefined, undefined);
    const created = await addAccount({
      username: "no-log",
      password: "handed-over-by-admin",
      displayName: "No Log",
      role: "employee",
      actor: "admin",
    });
    expect(created.ok).toBe(true);
    expect(await updateRole("no-log", "manager", "admin")).toEqual({ ok: true });
  });
});
