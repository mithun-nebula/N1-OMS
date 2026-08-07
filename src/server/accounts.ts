import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import type { RbacRole } from "@/domains/shared/people-roster";
import { hashPassword, verifyPassword, type AuthUser } from "./auth";

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

export const ACCOUNTS: Account[] = [...SYSTEM_ACCOUNTS, ...personAccounts()].map(
  (raw) => ({ ...raw, passwordHash: hashPassword(raw.password) }),
);

const BY_USERNAME = new Map(ACCOUNTS.map((a) => [a.username, a]));
const BY_PERSON = new Map(ACCOUNTS.map((a) => [a.personId, a]));

export function findAccount(username: string): Account | undefined {
  return BY_USERNAME.get(username);
}

export function accountOfActor(actorId: string): Account | undefined {
  return BY_PERSON.get(actorId);
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
  const account = BY_USERNAME.get(username);
  if (!account) return null;
  if (!verifyPassword(password, account.passwordHash)) return null;
  return {
    id: account.personId,
    username: account.username,
    role: account.role,
    displayName: account.displayName,
  };
}
