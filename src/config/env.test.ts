import { describe, it, expect } from "vitest";
import { env, resolveSeedDemo } from "./env";

/**
 * The demo seed is load-bearing in two opposite directions:
 *
 *  - Every one of the 12 domain test files builds its world with
 *    `buildDemoWorld()` and asserts against the seeded roster. If the seed can
 *    be switched off under test, the whole suite goes down — and `test:db`
 *    sources `.env`, so a production-shaped `.env` could do exactly that.
 *  - On a real deployment the seed must NOT run: it would create nine fake
 *    employees and six logins whose passwords are printed in AGENTS.md.
 */
describe("resolveSeedDemo", () => {
  it("always seeds under test, whatever .env says", () => {
    expect(resolveSeedDemo({ isTest: true, isProduction: false, explicit: "false" })).toBe(true);
    expect(resolveSeedDemo({ isTest: true, isProduction: true, explicit: "false" })).toBe(true);
  });

  it("honours an explicit setting outside test", () => {
    expect(resolveSeedDemo({ isTest: false, isProduction: false, explicit: "false" })).toBe(false);
    expect(resolveSeedDemo({ isTest: false, isProduction: false, explicit: "FALSE" })).toBe(false);
    expect(resolveSeedDemo({ isTest: false, isProduction: true, explicit: "true" })).toBe(true);
  });

  it("defaults off in production and on in development", () => {
    expect(resolveSeedDemo({ isTest: false, isProduction: true })).toBe(false);
    expect(resolveSeedDemo({ isTest: false, isProduction: false })).toBe(true);
  });

  it("the running suite has seeding on", () => {
    // Guards the whole suite: if this ever reads false, 149 tests lose their data.
    expect(env().isTest).toBe(true);
    expect(env().seedDemo).toBe(true);
  });
});
