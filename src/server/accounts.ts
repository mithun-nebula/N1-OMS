import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import type { RbacRole } from "@/domains/shared/people-roster";
import { hashPassword, verifyPassword, type AuthUser } from "./auth";
import type { Pool } from "pg";

export interface Account {
  username: string;
  personId: string;
  role: RbacRole;
  displayName: string;
  team?: string;
  passwordHash: string;
}

interface RawAccount {
  username: string;
  personId: string;
  role: RbacRole;
  displayName: string;
  team?: string;
  password: string;
}

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

function buildDefaultAccounts(): Account[] {
  return [...SYSTEM_ACCOUNTS, ...personAccounts()].map((raw) => ({
    ...raw,
    passwordHash: hashPassword(raw.password),
  }));
}

// Mutable so configureAccounts() can hydrate from Postgres.
let accountList: Account[] = buildDefaultAccounts();
let byUsername = new Map(accountList.map((a) => [a.username, a]));
let byPerson = new Map(accountList.map((a) => [a.personId, a]));
let dbPool: Pool | null = null;

interface AccountRow {
  username: string;
  person_id: string;
  role: string;
  display_name: string;
  team: string | null;
  password_hash: string;
}

function rowToAccount(row: AccountRow): Account {
  return {
    username: row.username,
    personId: row.person_id,
    role: row.role as RbacRole,
    displayName: row.display_name,
    team: row.team ?? undefined,
    passwordHash: row.password_hash,
  };
}

/**
 * Called once at boot. With a pool: creates the table, seeds defaults on an
 * empty DB, then hydrates the in-memory maps from Postgres. Without a pool:
 * keeps the in-memory defaults (resets on restart). All reads stay sync.
 */
export async function configureAccounts(pool?: Pool): Promise<void> {
  dbPool = pool ?? null;
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
  `);

  const res = await pool.query<AccountRow>(
    "SELECT username, person_id, role, display_name, team, password_hash FROM orga_accounts",
  );

  if (res.rows.length === 0) {
    for (const a of accountList) {
      await pool.query(
        "INSERT INTO orga_accounts (username, person_id, role, display_name, team, password_hash) VALUES ($1,$2,$3,$4,$5,$6)",
        [a.username, a.personId, a.role, a.displayName, a.team ?? null, a.passwordHash],
      );
    }
  } else {
    accountList = res.rows.map(rowToAccount);
    byUsername = new Map(accountList.map((a) => [a.username, a]));
    byPerson = new Map(accountList.map((a) => [a.personId, a]));
  }
}

// ── sync reads (unchanged signatures — the gate consumes these synchronously) ──

export function findAccount(username: string): Account | undefined {
  return byUsername.get(username);
}

export function accountOfActor(actorId: string): Account | undefined {
  return byPerson.get(actorId);
}

export function roleOfActor(actorId: string): RbacRole | undefined {
  const person = DEMO_PEOPLE[actorId];
  if (person) return person.role;
  return accountOfActor(actorId)?.role;
}

export function verifyCredentials(
  username: string,
  password: string,
): AuthUser | null {
  const account = byUsername.get(username);
  if (!account) return null;
  if (!verifyPassword(password, account.passwordHash)) return null;
  return {
    id: account.personId,
    username: account.username,
    role: account.role,
    displayName: account.displayName,
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

export async function addAccount(input: {
  username: string;
  password: string;
  displayName: string;
  role: RbacRole;
  team?: string;
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
  };
  accountList.push(account);
  byUsername.set(account.username, account);
  byPerson.set(account.personId, account);
  if (dbPool) {
    await dbPool.query(
      "INSERT INTO orga_accounts (username, person_id, role, display_name, team, password_hash) VALUES ($1,$2,$3,$4,$5,$6)",
      [account.username, account.personId, account.role, account.displayName, account.team ?? null, account.passwordHash],
    );
  }
  return { ok: true };
}

export async function updateRole(
  username: string,
  role: RbacRole,
): Promise<{ ok: boolean; error?: string }> {
  const account = byUsername.get(username);
  if (!account) return { ok: false, error: "Account not found." };
  account.role = role;
  if (dbPool) {
    await dbPool.query("UPDATE orga_accounts SET role=$2 WHERE username=$1", [username, role]);
  }
  return { ok: true };
}

export async function changePassword(
  username: string,
  current: string,
  next: string,
): Promise<{ ok: boolean; error?: string }> {
  const account = byUsername.get(username);
  if (!account) return { ok: false, error: "Account not found." };
  if (!verifyPassword(current, account.passwordHash)) {
    return { ok: false, error: "Current password is incorrect." };
  }
  if (next.length < 6) {
    return { ok: false, error: "New password must be at least 6 characters." };
  }
  account.passwordHash = hashPassword(next);
  if (dbPool) {
    await dbPool.query("UPDATE orga_accounts SET password_hash=$2 WHERE username=$1", [username, account.passwordHash]);
  }
  return { ok: true };
}

export async function resetPassword(
  username: string,
  next: string,
): Promise<{ ok: boolean; error?: string }> {
  const account = byUsername.get(username);
  if (!account) return { ok: false, error: "Account not found." };
  if (next.length < 6) {
    return { ok: false, error: "New password must be at least 6 characters." };
  }
  account.passwordHash = hashPassword(next);
  if (dbPool) {
    await dbPool.query("UPDATE orga_accounts SET password_hash=$2 WHERE username=$1", [username, account.passwordHash]);
  }
  return { ok: true };
}
