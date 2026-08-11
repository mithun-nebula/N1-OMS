import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { Pool } from "pg";
import { PostgresRecordStore } from "./store-pg-record";
import { PostgresActivityLog } from "./store-pg-activity";
import { PostgresFigureStore } from "./store-pg-figures";

const DATABASE_URL = process.env.DATABASE_URL;
const itIfDb = DATABASE_URL ? it : it.skip;

// Each test gets an isolated schema prefix to avoid collisions; we clean up the
// rows we write. These only run against a real Postgres (e.g. local `supabase
// start` or a Supabase project). They are skipped entirely without DATABASE_URL.

function pool(): Pool {
  const host = (() => { try { return new URL(DATABASE_URL!).hostname; } catch { return ""; } })();
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(host);
  return new Pool({ connectionString: DATABASE_URL, ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }) });
}

// Ensure the full schema exists up front so afterEach cleanup never hits
// "relation does not exist" (tables are otherwise created lazily per-store).
beforeAll(async () => {
  if (!DATABASE_URL) return;
  const p = pool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS orga_nodes (
      type text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
      version int NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (type, id));
    CREATE TABLE IF NOT EXISTS orga_edges (
      from_id text NOT NULL, to_id text NOT NULL, type text NOT NULL,
      data jsonb, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS orga_activity (
      id text PRIMARY KEY, data jsonb NOT NULL, at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS orga_figures (
      id text PRIMARY KEY, source_type text NOT NULL, source_id text NOT NULL,
      label text NOT NULL, data jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS orga_accounts (
      username text PRIMARY KEY, person_id text NOT NULL, role text NOT NULL,
      display_name text NOT NULL, team text, password_hash text NOT NULL);
    CREATE TABLE IF NOT EXISTS orga_autonomy_rules (
      rule_id text PRIMARY KEY, data jsonb NOT NULL);
  `);
  await p.end();
});

afterEach(async () => {
  if (!DATABASE_URL) return;
  const p = pool();
  await p.query("DELETE FROM orga_nodes");
  await p.query("DELETE FROM orga_edges");
  await p.query("DELETE FROM orga_activity");
  await p.query("DELETE FROM orga_figures");
  await p.query("DELETE FROM orga_autonomy_rules");
  await p.end();
});

describe("PostgresRecordStore — durability", { skip: !DATABASE_URL }, () => {
  itIfDb("persists a node and reads it back across instances", async () => {
    const a = new PostgresRecordStore(pool());
    await a.putNode("task", "pg-1", { title: "Survive restart", status: "todo" });
    await new Promise((r) => setTimeout(r, 50));

    const b = new PostgresRecordStore(pool()); // fresh instance, same DB
    const node = await b.getNode("task", "pg-1");
    expect(node?.data.title).toBe("Survive restart");
    expect(node?.version).toBe(1);

    await b.patchNode("task", "pg-1", { status: "done" });
    const after = await a.getNode("task", "pg-1");
    expect(after?.data.status).toBe("done");
    expect(after?.version).toBe(2);
  });

  itIfDb("find returns matching nodes", async () => {
    const store = new PostgresRecordStore(pool());
    await store.putNode("task", "pg-a", { k: 1 });
    await store.putNode("task", "pg-b", { k: 2 });
    await new Promise((r) => setTimeout(r, 50));
    const found = await store.find("task", (n) => (n.data as { k?: number }).k === 2);
    expect(found.length).toBe(1);
    expect(found[0].id).toBe("pg-b");
  });

  itIfDb("edges survive and traverse", async () => {
    const store = new PostgresRecordStore(pool());
    await store.putNode("employee", "emp-1", { name: "A" });
    await store.putNode("equipment", "eq-1", { name: "Laptop" });
    await store.addEdge({ from: "emp-1", to: "eq-1", type: "holds" });
    await new Promise((r) => setTimeout(r, 50));
    const reached = await store.traverse({
      start: "emp-1",
      steps: [{ edgeType: "holds", direction: "out" }],
    });
    expect(reached.find((n) => n.id === "eq-1")).toBeTruthy();
  });
});

describe("PostgresActivityLog + FigureStore — durability", { skip: !DATABASE_URL }, () => {
  itIfDb("activity entries persist across instances", async () => {
    const a = new PostgresActivityLog(pool());
    await a.append({
      id: "act_pg1",
      operationId: "op1",
      operationName: "test.op",
      actor: "x",
      authority: { kind: "self", actor: "x" },
      startedBy: { kind: "form", at: "2026-01-01T00:00:00Z", actor: "x" },
      at: "2026-01-01T00:00:00Z",
      changes: [],
      outcome: "ran",
    });
    await new Promise((r) => setTimeout(r, 50));
    const b = new PostgresActivityLog(pool());
    const got = await b.get("act_pg1");
    expect(got?.operationName).toBe("test.op");
    const queried = await b.query({ actor: "x" });
    expect(queried.length).toBe(1);
  });

  itIfDb("figures persist and open into their parts", async () => {
    const a = new PostgresFigureStore(pool());
    const fig = {
      id: "fig_pg1",
      label: "Course completion",
      value: 60,
      unit: "%",
      computedFrom: [{ label: "Modules finished", value: 3 }],
      explainer: "3 of 5",
      computedAt: "2026-01-01T00:00:00Z",
      sourceNodeType: "course",
      sourceNodeId: "c1",
    };
    await a.put(fig);
    await new Promise((r) => setTimeout(r, 50));
    const b = new PostgresFigureStore(pool());
    const got = await b.get("fig_pg1");
    expect(got?.value).toBe(60);
    const bd = await b.breakdown("fig_pg1");
    expect(bd?.parts[0].label).toBe("Modules finished");
  });
});

describe("orga_accounts — credential durability", { skip: !DATABASE_URL }, () => {
  itIfDb("configureAccounts seeds defaults then hydrates on restart", async () => {
    const { configureAccounts, findAccount, listAccounts } = await import("./accounts");
    const p = pool();
    await p.query("DROP TABLE IF EXISTS orga_accounts");
    await p.end();

    // First boot: seeds defaults
    await configureAccounts(pool());
    expect(listAccounts().length).toBeGreaterThan(5);
    expect(findAccount("employee")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 100));

    // Second boot (fresh module state): hydrates from DB
    await configureAccounts(pool());
    expect(listAccounts().length).toBeGreaterThan(5);
    expect(findAccount("employee")).toBeTruthy();
  });

  itIfDb("changePassword persists across restart", async () => {
    const { configureAccounts, changePassword, verifyCredentials } = await import("./accounts");
    await configureAccounts(pool());
    const ok = await changePassword("employee", "employee123", "newpass-99");
    expect(ok.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 100));

    // Restart → re-configure → new password works
    await configureAccounts(pool());
    const user = verifyCredentials("employee", "newpass-99");
    expect(user).toBeTruthy();
    // Old password fails
    expect(verifyCredentials("employee", "employee123")).toBeNull();

    // Restore for other tests
    await changePassword("employee", "newpass-99", "employee123");
  });
});

describe("orga_autonomy_rules — graduation durability", { skip: !DATABASE_URL }, () => {
  itIfDb("autonomy state persists across restart", async () => {
    const { AutonomyStore } = await import("@/domains/autonomy/store");
    const p1 = pool();
    const store1 = new AutonomyStore(p1);
    await store1.init();
    store1.set({ ruleId: "test-rule-pg", author: "james", opName: "announcement.send", cleanCount: 7, status: "supervised" });
    await new Promise((r) => setTimeout(r, 150));

    // Fresh instance, same DB
    const store2 = new AutonomyStore(pool());
    await store2.init();
    const state = store2.get("test-rule-pg");
    expect(state?.cleanCount).toBe(7);
    expect(state?.status).toBe("supervised");

    // Clean up
    await p1.query("DELETE FROM orga_autonomy_rules WHERE rule_id=$1", ["test-rule-pg"]);
    await p1.end();
  });
});
