import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import type { RbacRole } from "@/domains/shared/people-roster";
import { hashPassword, verifyPassword, type AuthUser } from "./auth";
import { env } from "@/config/env";
import { directory } from "./directory";
import { temporaryPasswordExpiry } from "./roles";
import type { Pool } from "pg";
import type { ActivityLog, ActivityEntry } from "@/spine/activity-log/types";
import type { ChangeSummary } from "@/spine/operation/registry";
import { generateOperationId } from "@/spine/operation/types";

export interface Account {
  username: string;
  personId: string;
  role: RbacRole;
  displayName: string;
  team?: string;
  passwordHash: string;
  /** Blocks every page except the password form until the password is replaced. */
  mustChangePassword?: boolean;
  /**
   * When a temporary password stops working. Set alongside
   * `mustChangePassword`; cleared once the holder chooses their own.
   */
  temporaryPasswordExpiresAt?: string;
}

interface RawAccount {
  username: string;
  personId: string;
  role: RbacRole;
  displayName: string;
  team?: string;
  password: string;
  mustChangePassword?: boolean;
  temporaryPasswordExpiresAt?: string;
}

/**
 * Demo-only system logins. Gated by `ORG_SEED_DEMO` along with the rest of the
 * demo data — their passwords are printed in AGENTS.md and on the login page,
 * so they must never exist on a real deployment. The way in on a real, empty
 * database is `bootstrapAccount()` below.
 */
const SYSTEM_ACCOUNTS: RawAccount[] = [
  {
    username: "superadmin",
    personId: "superadmin",
    role: "super-admin",
    displayName: "Super Admin",
    password: "super123",
  },
  {
    username: "admin",
    personId: "admin",
    role: "admin",
    displayName: "Administrator",
    password: "admin123",
  },
];

/**
 * The single super-admin created on a first boot against an empty accounts
 * table, from ORG_BOOTSTRAP_USER / ORG_BOOTSTRAP_PASSWORD.
 *
 * It is flagged `mustChangePassword`, so the initial password from `.env` gets
 * someone through the door exactly once and is then useless. Everyone else is
 * added in-platform.
 */
function bootstrapAccount(): RawAccount | undefined {
  const e = env();
  if (!e.bootstrapUser || !e.bootstrapPassword) return undefined;
  return {
    username: e.bootstrapUser,
    personId: e.bootstrapUser,
    role: "super-admin",
    displayName: "Administrator",
    password: e.bootstrapPassword,
    mustChangePassword: true,
    temporaryPasswordExpiresAt: temporaryPasswordExpiry(),
  };
}

const USERNAME_OVERRIDE: Record<string, string> = {
  shruti: "hr",
  james: "manager",
  priya: "employee",
  ravi: "intern",
};

function personAccounts(): RawAccount[] {
  return Object.entries(DEMO_PEOPLE).map(([id, person]) => ({
    username: USERNAME_OVERRIDE[id] ?? id,
    personId: id,
    role: person.role,
    displayName: person.name,
    team: person.team,
    password: defaultPasswordFor(person.role),
  }));
}

function defaultPasswordFor(role: RbacRole): string {
  switch (role) {
    case "hr":
      return "hr123";
    case "manager":
      return "manager123";
    case "employee":
      return "employee123";
    case "intern":
      return "intern123";
    default:
      return "orga123";
  }
}

/**
 * The accounts a first boot creates.
 *
 * With demo data on: the two system logins plus one per demo person.
 * With demo data off: only the bootstrap super-admin, which is the sole way
 * into a real, empty deployment.
 */
function buildDefaultAccounts(): Account[] {
  const raw: RawAccount[] = env().seedDemo
    ? [...SYSTEM_ACCOUNTS, ...personAccounts()]
    : [];
  const bootstrap = bootstrapAccount();
  if (bootstrap && !raw.some((a) => a.username === bootstrap.username)) {
    raw.unshift(bootstrap);
  }
  return raw.map((a) => ({
    username: a.username,
    personId: a.personId,
    role: a.role,
    displayName: a.displayName,
    team: a.team,
    passwordHash: hashPassword(a.password),
    mustChangePassword: a.mustChangePassword,
    temporaryPasswordExpiresAt: a.temporaryPasswordExpiresAt,
  }));
}

// Mutable so configureAccounts() can hydrate from Postgres.
let accountList: Account[] = buildDefaultAccounts();
let byUsername = new Map(accountList.map((a) => [a.username, a]));
let byPerson = new Map(accountList.map((a) => [a.personId, a]));
let dbPool: Pool | null = null;
/**
 * Optional, exactly like `DayPlanStore`'s persistence. Absent (as in every
 * existing test) appending is a no-op, so nothing that already worked has to
 * change to accommodate the log.
 */
let activityLog: ActivityLog | null = null;

interface AccountRow {
  username: string;
  person_id: string;
  role: string;
  display_name: string;
  team: string | null;
  password_hash: string;
  must_change_password: boolean | null;
  temporary_password_expires_at: string | null;
}

const ACCOUNT_COLUMNS =
  "username, person_id, role, display_name, team, password_hash, must_change_password, temporary_password_expires_at";

function rowToAccount(row: AccountRow): Account {
  return {
    username: row.username,
    personId: row.person_id,
    role: row.role as RbacRole,
    displayName: row.display_name,
    team: row.team ?? undefined,
    passwordHash: row.password_hash,
    mustChangePassword: row.must_change_password ?? false,
    temporaryPasswordExpiresAt: row.temporary_password_expires_at ?? undefined,
  };
}

/**
 * Called once at boot. With a pool: creates the table, seeds defaults on an
 * empty DB, then hydrates the in-memory maps from Postgres. Without a pool:
 * keeps the in-memory defaults (resets on restart). All reads stay sync.
 */
export async function configureAccounts(pool?: Pool, log?: ActivityLog): Promise<void> {
  dbPool = pool ?? null;
  activityLog = log ?? null;
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orga_accounts (
      username      text PRIMARY KEY,
      person_id     text NOT NULL,
      role          text NOT NULL,
      display_name  text NOT NULL,
      team          text,
      password_hash text NOT NULL
    );
    ALTER TABLE orga_accounts
      ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
    ALTER TABLE orga_accounts
      ADD COLUMN IF NOT EXISTS temporary_password_expires_at timestamptz;
  `);

  const res = await pool.query<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM orga_accounts`,
  );

  if (res.rows.length === 0) {
    // First boot against an empty table. On a real deployment `accountList` is
    // just the bootstrap super-admin; with demo data on it is the nine logins.
    if (accountList.length === 0) {
      throw new Error(
        "No accounts to create: set ORG_BOOTSTRAP_USER and ORG_BOOTSTRAP_PASSWORD, " +
          "or enable ORG_SEED_DEMO. Nobody could sign in otherwise.",
      );
    }
    for (const a of accountList) {
      await insertAccount(pool, a);
    }
  } else {
    accountList = res.rows.map(rowToAccount);
    byUsername = new Map(accountList.map((a) => [a.username, a]));
    byPerson = new Map(accountList.map((a) => [a.personId, a]));
  }
}

async function insertAccount(pool: Pool, a: Account): Promise<void> {
  await pool.query(
    `INSERT INTO orga_accounts (${ACCOUNT_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      a.username,
      a.personId,
      a.role,
      a.displayName,
      a.team ?? null,
      a.passwordHash,
      a.mustChangePassword ?? false,
      a.temporaryPasswordExpiresAt ?? null,
    ],
  );
}

// ── the record of who changed what ──

/**
 * Accounts decide who can sign in and what they may do, and until now not one
 * of these writes left a trace — `log.append` existed only in `spine.ts`.
 * Granting somebody the admin role was unrecordable.
 *
 * They are logged rather than turned into gated operations on purpose:
 * `configureAccounts(pool)` runs inside `buildDemoWorld()` *before* the spine
 * exists, because `verifyCredentials` has to work for the very first sign-in.
 * Routing these through `Spine.submit()` would mean solving that ordering
 * problem for marginal gain. The gap being closed is "we cannot prove what
 * happened", and an append-only entry closes exactly that.
 *
 * No `undoDescription` and no `undoPlan`: there is no safe automatic undo for
 * "made someone an admin", and `spine.undo` correctly refuses an entry that
 * carries neither.
 *
 * ***Never pass a password, a hash, or a temporary password in `changes`.***
 * Record *that* a password changed, never what to.
 */
async function recordAccountChange(input: {
  operationName: string;
  actor: string;
  changes: ChangeSummary[];
}): Promise<void> {
  const log = activityLog;
  if (!log) return;
  try {
    const at = new Date().toISOString();
    const entry: ActivityEntry = {
      id: await log.nextId(),
      operationId: generateOperationId(),
      operationName: input.operationName,
      actor: input.actor,
      authority: { kind: "self", actor: input.actor },
      startedBy: { kind: "form", at, actor: input.actor },
      at,
      changes: input.changes,
      outcome: "ran",
    };
    await log.append(entry);
  } catch (error) {
    // The record must never be able to fail the change it describes — the same
    // rule the day-plan reactions follow. A lost entry is bad; a password reset
    // that half-happened because logging threw is worse.
    console.warn(
      `[accounts] could not record ${input.operationName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ── sync reads (unchanged signatures — the gate consumes these synchronously) ──

export function findAccount(username: string): Account | undefined {
  return byUsername.get(username);
}

export function accountOfActor(actorId: string): Account | undefined {
  return byPerson.get(actorId);
}

/**
 * The role the gate applies to this actor.
 *
 * The **account** is the source of truth. It used to check the hardcoded roster
 * first, which meant changing someone's role in `/admin` appeared to work and
 * silently did nothing for any of the nine seeded people — the gate kept
 * reading the old value out of a constant.
 *
 * Falls back to the directory for an actor with a record but no login, then to
 * the roster while demo data is still seeded.
 */
export function roleOfActor(actorId: string): RbacRole | undefined {
  const fromAccount = accountOfActor(actorId)?.role;
  if (fromAccount) return fromAccount;
  const fromDirectory = directory().roleOf(actorId);
  if (fromDirectory) return fromDirectory;
  return DEMO_PEOPLE[actorId]?.role;
}

export function verifyCredentials(
  username: string,
  password: string,
): AuthUser | null {
  const account = byUsername.get(username);
  if (!account) return null;
  if (!verifyPassword(password, account.passwordHash)) return null;
  // An unused temporary password stops working once it expires. The holder has
  // to ask for another reset — the same opaque failure as a wrong password, so
  // it discloses nothing about whether the account exists.
  if (isTemporaryPasswordExpired(account)) return null;
  return {
    id: account.personId,
    username: account.username,
    role: account.role,
    displayName: account.displayName,
    mustChangePassword: account.mustChangePassword === true,
  };
}

export function listAccounts(): Array<{
  username: string;
  personId: string;
  role: RbacRole;
  displayName: string;
  team?: string;
}> {
  return accountList.map(({ passwordHash: _ph, ...rest }) => {
    void _ph;
    return rest;
  });
}

// ── async mutations (write-through to Postgres when pool is set) ──

/**
 * Creates a login. The password an admin types here is a **temporary** one:
 * the account is flagged `mustChangePassword`, so the holder has to replace it
 * at first sign-in and the value the admin knows stops working.
 *
 * Set `mustChangePassword: false` only for a login whose password was chosen by
 * the person themselves.
 */
export async function addAccount(input: {
  username: string;
  password: string;
  displayName: string;
  role: RbacRole;
  team?: string;
  mustChangePassword?: boolean;
  /** Who is creating this login. Recorded on the activity entry. */
  actor: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (byUsername.has(input.username)) {
    return { ok: false, error: "Username already exists." };
  }
  const personId = input.username.toLowerCase().replace(/[^a-z0-9]/g, "-");
  if (byPerson.has(personId)) {
    return { ok: false, error: "That name is already in use." };
  }
  const account: Account = {
    username: input.username,
    personId,
    role: input.role,
    displayName: input.displayName,
    team: input.team,
    passwordHash: hashPassword(input.password),
    mustChangePassword: input.mustChangePassword ?? true,
    temporaryPasswordExpiresAt:
      (input.mustChangePassword ?? true) ? temporaryPasswordExpiry() : undefined,
  };
  accountList.push(account);
  byUsername.set(account.username, account);
  byPerson.set(account.personId, account);
  if (dbPool) await insertAccount(dbPool, account);
  await recordAccountChange({
    operationName: "account.add",
    actor: input.actor,
    changes: [
      {
        nodeType: "account",
        nodeId: account.username,
        after: {
          username: account.username,
          personId: account.personId,
          role: account.role,
          displayName: account.displayName,
          team: account.team,
          mustChangePassword: account.mustChangePassword,
        },
      },
    ],
  });
  return { ok: true };
}

/**
 * Create a login for an existing person, with the account's `personId` set
 * explicitly rather than derived from the username.
 *
 * `addAccount()` builds `personId` by slugifying the username, which is wrong
 * here: the employee node id **is** the actor id the permission layer keys on
 * (`ownerOf("employee", id) === id`). If the account's personId and the
 * employee node id ever diverge, every `self` and `own-team` scope silently
 * fails for that person — and because refusal is opaque by design, it is close
 * to undebuggable.
 */
export async function addAccountForPerson(input: {
  personId: string;
  username: string;
  temporaryPassword: string;
  displayName: string;
  role: RbacRole;
  team?: string;
  /** Who is creating this login. Recorded on the activity entry. */
  actor: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (byUsername.has(input.username)) {
    return { ok: false, error: "That username is already taken." };
  }
  if (byPerson.has(input.personId)) {
    return { ok: false, error: "That person already has a login." };
  }
  const account: Account = {
    username: input.username,
    personId: input.personId,
    role: input.role,
    displayName: input.displayName,
    team: input.team,
    passwordHash: hashPassword(input.temporaryPassword),
    mustChangePassword: true,
    temporaryPasswordExpiresAt: temporaryPasswordExpiry(),
  };
  accountList.push(account);
  byUsername.set(account.username, account);
  byPerson.set(account.personId, account);
  if (dbPool) await insertAccount(dbPool, account);
  await recordAccountChange({
    operationName: "account.addForPerson",
    actor: input.actor,
    changes: [
      {
        nodeType: "account",
        nodeId: account.username,
        after: {
          username: account.username,
          personId: account.personId,
          role: account.role,
          displayName: account.displayName,
          team: account.team,
          mustChangePassword: true,
        },
      },
    ],
  });
  return { ok: true };
}

/** Remove a login entirely. Used to undo a person who was just created. */
export async function removeAccount(username: string, actor: string): Promise<void> {
  const account = byUsername.get(username);
  // Nothing happened, so nothing is recorded.
  if (!account) return;
  accountList = accountList.filter((a) => a.username !== username);
  byUsername.delete(account.username);
  byPerson.delete(account.personId);
  if (dbPool) {
    await dbPool.query("DELETE FROM orga_accounts WHERE username=$1", [username]);
  }
  await recordAccountChange({
    operationName: "account.remove",
    actor,
    changes: [
      {
        nodeType: "account",
        nodeId: username,
        before: {
          username: account.username,
          personId: account.personId,
          role: account.role,
          displayName: account.displayName,
        },
      },
    ],
  });
}

/**
 * Stop a login working without deleting it — the account row, and the history
 * attached to it, stay. Implemented as an unusable password hash so every
 * existing sync reader keeps working unchanged.
 */
export async function setAccountEnabled(
  personId: string,
  enabled: boolean,
  actor: string,
): Promise<void> {
  const account = byPerson.get(personId);
  if (!account) return;
  if (enabled) {
    // Re-enabling needs a fresh temporary password, set by whoever reactivates.
    // Nothing changed here, so there is nothing to record.
    return;
  }
  account.passwordHash = hashPassword(randomUnusablePassword());
  account.mustChangePassword = false;
  account.temporaryPasswordExpiresAt = undefined;
  if (dbPool) {
    await dbPool.query(
      "UPDATE orga_accounts SET password_hash=$2, must_change_password=false, temporary_password_expires_at=NULL WHERE username=$1",
      [account.username, account.passwordHash],
    );
  }
  // The hash is deliberately absent: the entry says the login was disabled,
  // never what it was disabled to.
  await recordAccountChange({
    operationName: "account.setEnabled",
    actor,
    changes: [
      {
        nodeType: "account",
        nodeId: account.username,
        before: { enabled: true },
        after: { enabled: false, personId: account.personId },
      },
    ],
  });
}

function randomUnusablePassword(): string {
  return `disabled-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export async function updateRole(
  username: string,
  role: RbacRole,
  actor: string,
): Promise<{ ok: boolean; error?: string }> {
  const account = byUsername.get(username);
  if (!account) return { ok: false, error: "Account not found." };
  const previousRole = account.role;
  account.role = role;
  if (dbPool) {
    await dbPool.query("UPDATE orga_accounts SET role=$2 WHERE username=$1", [username, role]);
  }
  await recordAccountChange({
    operationName: "account.updateRole",
    actor,
    changes: [
      {
        nodeType: "account",
        nodeId: username,
        before: { role: previousRole },
        after: { role },
      },
    ],
  });
  return { ok: true };
}

export async function changePassword(
  username: string,
  current: string,
  next: string,
  actor: string,
): Promise<{ ok: boolean; error?: string }> {
  const account = byUsername.get(username);
  if (!account) return { ok: false, error: "Account not found." };
  if (!verifyPassword(current, account.passwordHash)) {
    return { ok: false, error: "Current password is incorrect." };
  }
  if (next.length < 6) {
    return { ok: false, error: "New password must be at least 6 characters." };
  }
  // Changing your own password is what clears the forced-change gate.
  account.passwordHash = hashPassword(next);
  account.mustChangePassword = false;
  account.temporaryPasswordExpiresAt = undefined;
  if (dbPool) {
    await dbPool.query(
      "UPDATE orga_accounts SET password_hash=$2, must_change_password=false, temporary_password_expires_at=NULL WHERE username=$1",
      [username, account.passwordHash],
    );
  }
  // THAT it changed, never what to. No password, no hash, not even a length.
  await recordAccountChange({
    operationName: "account.changePassword",
    actor,
    changes: [
      {
        nodeType: "account",
        nodeId: username,
        after: { passwordChanged: true, mustChangePassword: false },
      },
    ],
  });
  return { ok: true };
}

export async function resetPassword(
  username: string,
  next: string,
  actor: string,
): Promise<{ ok: boolean; error?: string }> {
  const account = byUsername.get(username);
  if (!account) return { ok: false, error: "Account not found." };
  if (next.length < 6) {
    return { ok: false, error: "New password must be at least 6 characters." };
  }
  // An admin reset hands out a temporary password, so the holder must replace
  // it themselves before they can use the app.
  account.passwordHash = hashPassword(next);
  account.mustChangePassword = true;
  account.temporaryPasswordExpiresAt = temporaryPasswordExpiry();
  if (dbPool) {
    await dbPool.query(
      "UPDATE orga_accounts SET password_hash=$2, must_change_password=true, temporary_password_expires_at=$3 WHERE username=$1",
      [username, account.passwordHash, account.temporaryPasswordExpiresAt],
    );
  }
  // An admin reset is the single most impersonation-shaped write in the system,
  // so it is recorded — and the temporary password itself never is.
  await recordAccountChange({
    operationName: "account.resetPassword",
    actor,
    changes: [
      {
        nodeType: "account",
        nodeId: username,
        after: {
          passwordReset: true,
          mustChangePassword: true,
          temporaryPasswordExpiresAt: account.temporaryPasswordExpiresAt,
        },
      },
    ],
  });
  return { ok: true };
}

/** True when a temporary password has passed its expiry and no longer works. */
export function isTemporaryPasswordExpired(
  account: Account,
  now: Date = new Date(),
): boolean {
  if (!account.mustChangePassword) return false;
  if (!account.temporaryPasswordExpiresAt) return false;
  return new Date(account.temporaryPasswordExpiresAt).getTime() <= now.getTime();
}
