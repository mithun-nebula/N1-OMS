import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { Pool } from "pg";
import { PostgresRecordStore } from "./store-pg-record";
import { PostgresActivityLog } from "./store-pg-activity";
import { PostgresFigureStore } from "./store-pg-figures";

/**
 * These tests write to a real Postgres, and they used to write to *whatever*
 * `DATABASE_URL` pointed at.
 *
 * That was a loaded gun. `afterEach` issued unscoped `DELETE FROM orga_nodes`,
 * `orga_edges`, `orga_activity`, `orga_figures` and `orga_autonomy_rules`, and
 * the accounts test ran `DROP TABLE IF EXISTS orga_accounts`. Pointed at the
 * live database in `.env` — which is exactly what `npm run test:db` did, since
 * it sourced `.env` — one run would have deleted every record and destroyed
 * every login in the organisation. `docs/CURRENT-UPDATES.md` flagged the risk
 * and nothing enforced it.
 *
 * Three things now stand between this file and a production database:
 *
 *  1. It reads **`ORG_TEST_DATABASE_URL`**, never `DATABASE_URL`. You cannot
 *     reach the application's own database without deliberately naming it.
 *  2. It refuses to run if that URL is the same as `DATABASE_URL`.
 *  3. Every delete is scoped to the `TEST_PREFIX` these tests write under, so
 *     even a misconfigured test database keeps whatever else lives in it.
 *
 * Set `ORG_TEST_DATABASE_URL` to a throwaway database (local `supabase start`,
 * Docker Postgres, or a second Supabase project). Without it, every test here
 * skips — which is the safe default, not a failure.
 */
const TEST_DATABASE_URL = process.env.ORG_TEST_DATABASE_URL;
const LIVE_DATABASE_URL = process.env.DATABASE_URL;

const POINTS_AT_LIVE_DB =
  Boolean(TEST_DATABASE_URL) && TEST_DATABASE_URL === LIVE_DATABASE_URL;

if (POINTS_AT_LIVE_DB) {
  throw new Error(
    "ORG_TEST_DATABASE_URL is the same as DATABASE_URL. These tests delete rows " +
      "and must never run against the application's own database. Point it at a " +
      "throwaway database instead.",
  );
}

const DATABASE_URL = POINTS_AT_LIVE_DB ? undefined : TEST_DATABASE_URL;
const itIfDb = DATABASE_URL ? it : it.skip;

/**
 * Everything these tests write is named under this prefix, so cleanup can be
 * scoped to their own rows rather than emptying the table.
 */
const TEST_PREFIX = "pgtest";

/**
 * Tests that genuinely need a virgin schema — the accounts suite drops and
 * re-seeds `orga_accounts` to prove first-boot behaviour, which cannot be done
 * without destroying whatever logins are already there. Opt in explicitly.
 */
const DESTRUCTIVE_OK = process.env.ORG_TEST_DB_DESTRUCTIVE === "1";
const itIfDestructive = DATABASE_URL && DESTRUCTIVE_OK ? it : it.skip;

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
    ALTER TABLE orga_accounts
      ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS orga_autonomy_rules (
      rule_id text PRIMARY KEY, data jsonb NOT NULL);
    CREATE SEQUENCE IF NOT EXISTS orga_activity_seq;
    CREATE TABLE IF NOT EXISTS orga_day_plans (
      actor text NOT NULL, date text NOT NULL, data jsonb NOT NULL,
      PRIMARY KEY (actor, date));
    CREATE TABLE IF NOT EXISTS orga_day_streaks (
      actor text PRIMARY KEY, data jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS orga_day_estimates (
      key text PRIMARY KEY, estimate integer NOT NULL, actuals jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS orga_notifications (
      id text PRIMARY KEY, actor text, at text NOT NULL,
      payload jsonb NOT NULL, read_at text);
    CREATE TABLE IF NOT EXISTS orga_question_budget (
      actor text NOT NULL, date text NOT NULL, used integer NOT NULL,
      PRIMARY KEY (actor, date));
    CREATE TABLE IF NOT EXISTS orga_messages (
      id bigint PRIMARY KEY, conversation_id text NOT NULL, sender text NOT NULL,
      text text NOT NULL, at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS orga_message_reads (
      username text NOT NULL, conversation_id text NOT NULL,
      last_read_at timestamptz NOT NULL, PRIMARY KEY (username, conversation_id));
  `);
  await p.end();
});

/**
 * Scoped cleanup. Every statement is bounded to the test prefix — none of them
 * can empty a table. Ordered edges-then-nodes so nothing is briefly orphaned.
 */
afterEach(async () => {
  if (!DATABASE_URL) return;
  const p = pool();
  const like = `${TEST_PREFIX}%`;
  await p.query("DELETE FROM orga_edges WHERE from_id LIKE $1 OR to_id LIKE $1", [like]);
  await p.query("DELETE FROM orga_nodes WHERE id LIKE $1", [like]);
  await p.query("DELETE FROM orga_activity WHERE id LIKE $1", [`act_${TEST_PREFIX}%`]);
  await p.query("DELETE FROM orga_figures WHERE id LIKE $1", [`fig_${TEST_PREFIX}%`]);
  await p.query("DELETE FROM orga_autonomy_rules WHERE rule_id LIKE $1", [like]);
  await p.query("DELETE FROM orga_day_plans WHERE actor LIKE $1", [like]);
  await p.query("DELETE FROM orga_day_streaks WHERE actor LIKE $1", [like]);
  await p.query("DELETE FROM orga_day_estimates WHERE key LIKE $1", [`task:${TEST_PREFIX}%`]);
  await p.query("DELETE FROM orga_notifications WHERE id LIKE $1", [`ntf_${TEST_PREFIX}%`]);
  await p.query("DELETE FROM orga_question_budget WHERE actor LIKE $1", [like]);
  await p.query("DELETE FROM orga_messages WHERE conversation_id LIKE $1", [`%${TEST_PREFIX}%`]);
  await p.query("DELETE FROM orga_message_reads WHERE username LIKE $1", [like]);
  await p.end();
});

describe("PostgresRecordStore — durability", { skip: !DATABASE_URL }, () => {
  itIfDb("persists a node and reads it back across instances", async () => {
    const a = new PostgresRecordStore(pool());
    await a.putNode("task", "pgtest-task-1", { title: "Survive restart", status: "todo" });
    await new Promise((r) => setTimeout(r, 50));

    const b = new PostgresRecordStore(pool()); // fresh instance, same DB
    const node = await b.getNode("task", "pgtest-task-1");
    expect(node?.data.title).toBe("Survive restart");
    expect(node?.version).toBe(1);

    await b.patchNode("task", "pgtest-task-1", { status: "done" });
    const after = await a.getNode("task", "pgtest-task-1");
    expect(after?.data.status).toBe("done");
    expect(after?.version).toBe(2);
  });

  itIfDb("find returns matching nodes", async () => {
    const store = new PostgresRecordStore(pool());
    await store.putNode("task", "pgtest-task-a", { k: 1 });
    await store.putNode("task", "pgtest-task-b", { k: 2 });
    await new Promise((r) => setTimeout(r, 50));
    const found = await store.find("task", (n) => (n.data as { k?: number }).k === 2);
    expect(found.length).toBe(1);
    expect(found[0].id).toBe("pgtest-task-b");
  });

  itIfDb("edges survive and traverse", async () => {
    const store = new PostgresRecordStore(pool());
    await store.putNode("employee", "pgtest-emp-1", { name: "A" });
    await store.putNode("equipment", "pgtest-eq-1", { name: "Laptop" });
    await store.addEdge({ from: "pgtest-emp-1", to: "pgtest-eq-1", type: "holds" });
    await new Promise((r) => setTimeout(r, 50));
    const reached = await store.traverse({
      start: "pgtest-emp-1",
      steps: [{ edgeType: "holds", direction: "out" }],
    });
    expect(reached.find((n) => n.id === "pgtest-eq-1")).toBeTruthy();
  });
});

describe("PostgresActivityLog + FigureStore — durability", { skip: !DATABASE_URL }, () => {
  itIfDb("activity entries persist across instances", async () => {
    const a = new PostgresActivityLog(pool());
    await a.append({
      id: "act_pgtest_1",
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
    const got = await b.get("act_pgtest_1");
    expect(got?.operationName).toBe("test.op");
    const queried = await b.query({ actor: "x" });
    expect(queried.length).toBe(1);
  });

  /**
   * The bug this covers: nextId() used to be a per-process counter, so a second
   * boot restarted at act_1 and collided with the first boot's entries — and
   * append() used ON CONFLICT DO NOTHING, so the new entry was discarded in
   * silence. An audit trail that quietly drops records is worse than none.
   */
  itIfDb("ids from separate instances never collide", async () => {
    const first = new PostgresActivityLog(pool());
    const second = new PostgresActivityLog(pool());
    const ids = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      ids.add(await first.nextId());
      ids.add(await second.nextId());
    }
    expect(ids.size).toBe(10);
  });

  itIfDb("a duplicate id fails loudly instead of being discarded", async () => {
    const log = new PostgresActivityLog(pool());
    const entry = {
      id: "act_pgtest_dup",
      operationId: "op_pgtest_dup",
      operationName: "test.op",
      actor: "x",
      authority: { kind: "self", actor: "x" } as const,
      startedBy: { kind: "form", at: "2026-01-01T00:00:00Z", actor: "x" } as const,
      at: "2026-01-01T00:00:00Z",
      changes: [],
      outcome: "ran" as const,
    };
    await log.append(entry);
    await expect(log.append(entry)).rejects.toThrow();
  });

  itIfDb("an undo plan survives a round trip through the database", async () => {
    const a = new PostgresActivityLog(pool());
    await a.append({
      id: "act_pgtest_plan",
      operationId: "op_pgtest_plan",
      operationName: "task.edit",
      actor: "priya",
      authority: { kind: "self", actor: "priya" },
      startedBy: { kind: "form", at: "2026-01-01T00:00:00Z", actor: "priya" },
      at: "2026-01-01T00:00:00Z",
      changes: [],
      undoDescription: "Revert edits.",
      undoPlan: [
        { op: "patch", nodeType: "task", nodeId: "task_1", data: { title: "Before" } },
      ],
      outcome: "ran",
    });
    await new Promise((r) => setTimeout(r, 50));
    const b = new PostgresActivityLog(pool());
    const got = await b.get("act_pgtest_plan");
    expect(got?.undoPlan?.[0]).toMatchObject({
      op: "patch",
      nodeType: "task",
      nodeId: "task_1",
    });
  });

  itIfDb("figures persist and open into their parts", async () => {
    const a = new PostgresFigureStore(pool());
    const fig = {
      id: "fig_pgtest_1",
      label: "Course completion",
      value: 60,
      unit: "%",
      computedFrom: [{ label: "Modules finished", value: 3 }],
      explainer: "3 of 5",
      computedAt: "2026-01-01T00:00:00Z",
      sourceNodeType: "course",
      sourceNodeId: "pgtest-course-1",
    };
    await a.put(fig);
    await new Promise((r) => setTimeout(r, 50));
    const b = new PostgresFigureStore(pool());
    const got = await b.get("fig_pgtest_1");
    expect(got?.value).toBe(60);
    const bd = await b.breakdown("fig_pgtest_1");
    expect(bd?.parts[0].label).toBe("Modules finished");
  });
});

/**
 * These two drop and re-seed `orga_accounts`, and change a live password.
 * There is no non-destructive way to prove first-boot seeding, so they are
 * opt-in: set `ORG_TEST_DB_DESTRUCTIVE=1` against a database you are willing
 * to lose. Without it they skip, and the rest of the file still runs.
 */
describe("orga_accounts — credential durability", { skip: !DATABASE_URL || !DESTRUCTIVE_OK }, () => {
  itIfDestructive("configureAccounts seeds defaults then hydrates on restart", async () => {
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

  itIfDestructive("changePassword persists across restart", async () => {
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
    store1.set({ ruleId: "pgtest-rule", author: "james", opName: "notify.send", cleanCount: 7, status: "supervised" });
    await new Promise((r) => setTimeout(r, 150));

    // Fresh instance, same DB
    const store2 = new AutonomyStore(pool());
    await store2.init();
    const state = store2.get("pgtest-rule");
    expect(state?.cleanCount).toBe(7);
    expect(state?.status).toBe("supervised");

    // Clean up
    await p1.query("DELETE FROM orga_autonomy_rules WHERE rule_id=$1", ["pgtest-rule"]);
    await p1.end();
  });
});

describe("orga_day_plans — day-plan durability", { skip: !DATABASE_URL }, () => {
  itIfDb("plan, streak and estimates round-trip through a fresh persistence", async () => {
    const { PostgresDayPlanPersistence } = await import("./store-pg-dayplan");
    const p1 = pool();
    const a = new PostgresDayPlanPersistence(p1);
    await a.savePlan({
      actor: "pgtest-actor",
      date: "2026-08-18",
      phase: "planned",
      brief: { changed: [], needsYou: [], atRisk: [] },
      briefStep: 0,
      plan: [{ id: "i1", label: "Survive restart", estimateMinutes: 45 }],
      meetings: [],
      streak: { clean: 2, bestClean: 3, dayPlanned: 4 },
    });
    await a.saveStreak("pgtest-actor", { clean: 2, bestClean: 3, dayPlanned: 4 });
    await a.saveEstimate("task:pgtest", 60, [80, 100]);

    const b = new PostgresDayPlanPersistence(pool());
    const plan = await b.loadPlan("pgtest-actor", "2026-08-18");
    expect(plan?.phase).toBe("planned");
    expect(plan?.plan[0].label).toBe("Survive restart");
    expect((await b.loadStreak("pgtest-actor"))?.bestClean).toBe(3);
    expect(await b.loadEstimate("task:pgtest")).toEqual({ estimate: 60, actuals: [80, 100] });
    const all = await b.loadAllEstimates();
    expect(all.some((e) => e.key === "task:pgtest")).toBe(true);

    await p1.query("DELETE FROM orga_day_plans WHERE actor=$1", ["pgtest-actor"]);
    await p1.query("DELETE FROM orga_day_streaks WHERE actor=$1", ["pgtest-actor"]);
    await p1.query("DELETE FROM orga_day_estimates WHERE key=$1", ["task:pgtest"]);
    await p1.end();
  });
});

describe("orga_question_budget — the allowance survives a restart", { skip: !DATABASE_URL }, () => {
  itIfDb("keeps the higher count when two writes race", async () => {
    const { PostgresQuestionLimiterStore } = await import("./store-pg-limiter");
    const store = new PostgresQuestionLimiterStore(pool());
    await store.save(`${TEST_PREFIX}-actor`, "2026-08-18", 2);
    // A late write carrying a lower count must not hand the allowance back.
    await store.save(`${TEST_PREFIX}-actor`, "2026-08-18", 1);

    const rows = await store.loadFor("2026-08-18");
    expect(rows.find((r) => r.actor === `${TEST_PREFIX}-actor`)?.used).toBe(2);
  });

  itIfDb("a different day is a different allowance", async () => {
    const { PostgresQuestionLimiterStore } = await import("./store-pg-limiter");
    const store = new PostgresQuestionLimiterStore(pool());
    await store.save(`${TEST_PREFIX}-actor`, "2026-08-18", 2);

    const next = await store.loadFor("2026-08-19");
    expect(next.find((r) => r.actor === `${TEST_PREFIX}-actor`)).toBeUndefined();
  });
});

describe("orga_notifications — the bell survives a restart", { skip: !DATABASE_URL }, () => {
  const notification = (id: string, actor: string, message: string) => ({
    id,
    at: "2026-08-18T09:00:00.000Z",
    payload: { kind: "actor" as const, actor, message },
  });

  itIfDb("round-trips a notification and ignores a duplicate id", async () => {
    const { PostgresNotificationStore } = await import("./store-pg-notifications");
    const store = new PostgresNotificationStore(pool());
    const id = `ntf_${TEST_PREFIX}_1`;
    await store.append(notification(id, `${TEST_PREFIX}-james`, "Leave needs approval"));
    // ON CONFLICT DO NOTHING — a replayed append must not throw or duplicate.
    await store.append(notification(id, `${TEST_PREFIX}-james`, "changed text"));

    const rows = (await store.loadRecent(200)).filter((r) => r.id === id);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ actor: `${TEST_PREFIX}-james`, message: "Leave needs approval" });
    expect(rows[0].readAt).toBeUndefined();
  });

  itIfDb("marks read by id, leaving everything else alone", async () => {
    const { PostgresNotificationStore } = await import("./store-pg-notifications");
    const store = new PostgresNotificationStore(pool());
    const readId = `ntf_${TEST_PREFIX}_read`;
    const keptId = `ntf_${TEST_PREFIX}_kept`;
    await store.append(notification(readId, `${TEST_PREFIX}-james`, "One"));
    await store.append(notification(keptId, `${TEST_PREFIX}-james`, "Two"));

    // Exercises `id = ANY($1)` with a JS string array — the binding this file
    // exists to prove, since nothing else executes it.
    await store.markRead([readId], "2026-08-18T10:00:00.000Z");

    const rows = await store.loadRecent(200);
    expect(rows.find((r) => r.id === readId)?.readAt).toBe("2026-08-18T10:00:00.000Z");
    expect(rows.find((r) => r.id === keptId)?.readAt).toBeUndefined();
  });

  itIfDb("an empty id list is a no-op rather than an error", async () => {
    const { PostgresNotificationStore } = await import("./store-pg-notifications");
    const store = new PostgresNotificationStore(pool());
    await expect(store.markRead([], "2026-08-18T10:00:00.000Z")).resolves.toBeUndefined();
  });

  itIfDb("returns oldest-first, so the bus can append in order", async () => {
    const { PostgresNotificationStore } = await import("./store-pg-notifications");
    const store = new PostgresNotificationStore(pool());
    await store.append({
      id: `ntf_${TEST_PREFIX}_early`,
      at: "2026-08-18T08:00:00.000Z",
      payload: { kind: "actor", actor: `${TEST_PREFIX}-james`, message: "Early" },
    });
    await store.append({
      id: `ntf_${TEST_PREFIX}_late`,
      at: "2026-08-18T12:00:00.000Z",
      payload: { kind: "actor", actor: `${TEST_PREFIX}-james`, message: "Late" },
    });

    const mine = (await store.loadRecent(200)).filter((r) => r.id.startsWith(`ntf_${TEST_PREFIX}_`));
    expect(mine.map((r) => r.at)).toEqual([...mine.map((r) => r.at)].sort());
  });
});

describe("orga_day_plans — reading a range of days", { skip: !DATABASE_URL }, () => {
  itIfDb("returns only the days inside the range, oldest first", async () => {
    const { PostgresDayPlanPersistence } = await import("./store-pg-dayplan");
    const store = new PostgresDayPlanPersistence(pool());
    const actor = `${TEST_PREFIX}-range`;
    const day = (date: string) => ({
      actor,
      date,
      phase: "planned" as const,
      brief: { changed: [], needsYou: [], atRisk: [] },
      briefStep: 0,
      plan: [{ id: "i1", label: `Work ${date}`, estimateMinutes: 30 }],
      meetings: [],
      streak: { clean: 1, bestClean: 1, dayPlanned: 1 },
    });
    for (const date of ["2026-07-31", "2026-08-01", "2026-08-15", "2026-09-01"]) {
      await store.savePlan(day(date));
    }

    // Dates are text; this proves they compare chronologically anyway.
    const range = await store.loadRange(actor, "2026-08-01", "2026-08-31");
    expect(range.map((p) => p.date)).toEqual(["2026-08-01", "2026-08-15"]);
  });

  itIfDb("does not return another person's days", async () => {
    const { PostgresDayPlanPersistence } = await import("./store-pg-dayplan");
    const store = new PostgresDayPlanPersistence(pool());
    const base = {
      phase: "planned" as const,
      brief: { changed: [], needsYou: [], atRisk: [] },
      briefStep: 0,
      plan: [],
      meetings: [],
      streak: { clean: 0, bestClean: 0, dayPlanned: 0 },
    };
    await store.savePlan({ ...base, actor: `${TEST_PREFIX}-mine`, date: "2026-08-10" });
    await store.savePlan({ ...base, actor: `${TEST_PREFIX}-theirs`, date: "2026-08-10" });

    const mine = await store.loadRange(`${TEST_PREFIX}-mine`, "2026-08-01", "2026-08-31");
    expect(mine).toHaveLength(1);
    expect(mine[0].actor).toBe(`${TEST_PREFIX}-mine`);
  });
});

describe("orga_messages — chat durability", { skip: !DATABASE_URL }, () => {
  itIfDb("messages and read marks round-trip through a fresh persistence", async () => {
    const { PostgresMessagePersistence } = await import("./store-pg-messages");
    const p1 = pool();
    const a = new PostgresMessagePersistence(p1);
    await a.saveMessage({
      id: 900001,
      conversationId: "dm:pgtest-a|pgtest-b",
      from: "pgtest-a",
      text: "survive restart",
      at: "2026-08-18T09:00:00.000Z",
    });
    await a.saveRead("pgtest-b", "dm:pgtest-a|pgtest-b", "2026-08-18T09:05:00.000Z");

    const b = new PostgresMessagePersistence(pool());
    const messages = await b.loadMessages("dm:pgtest-a|pgtest-b");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: 900001, from: "pgtest-a", text: "survive restart" });
    const reads = await b.loadReads("pgtest-b");
    expect(reads.some((r) => r.conversationId === "dm:pgtest-a|pgtest-b")).toBe(true);
    expect(await b.maxId()).toBeGreaterThanOrEqual(900001);

    await p1.query("DELETE FROM orga_messages WHERE conversation_id=$1", ["dm:pgtest-a|pgtest-b"]);
    await p1.query("DELETE FROM orga_message_reads WHERE username=$1", ["pgtest-b"]);
    await p1.end();
  });
});
