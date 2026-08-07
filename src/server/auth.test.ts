import { describe, it, expect } from "vitest";
import {
  createSessionToken,
  readSessionToken,
  hashPassword,
  verifyPassword,
} from "./auth";
import {
  verifyCredentials,
  ACCOUNTS,
  roleOfActor,
} from "./accounts";

describe("auth — credentials", () => {
  it("accepts a correct username/password", () => {
    const user = verifyCredentials("employee", "employee123");
    expect(user).not.toBeNull();
    expect(user?.role).toBe("employee");
    expect(user?.id).toBe("priya");
  });

  it("rejects a wrong password", () => {
    expect(verifyCredentials("employee", "wrong")).toBeNull();
  });

  it("rejects an unknown user", () => {
    expect(verifyCredentials("nobody", "x")).toBeNull();
  });

  it("has one account per role", () => {
    const roles = new Set(ACCOUNTS.map((a) => a.role));
    for (const role of [
      "super-admin",
      "admin",
      "hr",
      "manager",
      "employee",
      "intern",
    ]) {
      expect(roles.has(role as never)).toBe(true);
    }
  });
});

describe("auth — password hashing", () => {
  it("hashes and verifies", () => {
    const stored = hashPassword("secret");
    expect(stored).not.toBe("secret");
    expect(verifyPassword("secret", stored)).toBe(true);
    expect(verifyPassword("other", stored)).toBe(false);
  });
});

describe("auth — session token", () => {
  it("round-trips a user and is tamper-proof", () => {
    const user = verifyCredentials("manager", "manager123")!;
    const token = createSessionToken(user);
    const read = readSessionToken(token);
    expect(read?.username).toBe("manager");
    expect(read?.id).toBe("james");
    expect(read?.role).toBe("manager");

    const tampered = token.slice(0, -2) + "aa";
    expect(readSessionToken(tampered)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(readSessionToken("not-a-token")).toBeNull();
    expect(readSessionToken(undefined)).toBeNull();
  });
});

describe("rbac — roles resolve per actor", () => {
  it("maps demo people to their RBAC role", () => {
    expect(roleOfActor("james")).toBe("manager");
    expect(roleOfActor("shruti")).toBe("hr");
    expect(roleOfActor("priya")).toBe("employee");
    expect(roleOfActor("ravi")).toBe("intern");
  });

  it("resolves system accounts", () => {
    expect(roleOfActor("superadmin")).toBe("super-admin");
    expect(roleOfActor("admin")).toBe("admin");
  });
});
