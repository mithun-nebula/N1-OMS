import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { Pool } from "pg";
import { PostgresRecordStore } from "./store-pg-record";
import { PostgresActivityLog } from "./store-pg-activity";
import { PostgresFigureStore } from "./store-pg-figures";
import { summariseDay } from "@/domains/assistant/day-plan/store";
import { buildDemoWorld } from "./bootstrap";
import { resetEnvCache } from "@/config/env";
import { Spine } from "@/spine/spine";
import * as adapters from "@/spine/adapters";

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
    CREATE TABLE IF NOT EXISTS orga_conversations (
      id text PRIMARY KEY, actor text NOT NULL, messages jsonb NOT NULL,
      updated_at text NOT NULL);
    CREATE TABLE IF NOT EXISTS orga_commitments (
      id text PRIMARY KEY, actor text NOT NULL, what text NOT NULL,
      due_date text NOT NULL, conversation_id text, created_at text NOT NULL,
      discharged_at text, discharged_as text);
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
  await p.query("DELETE FROM orga_conversations WHERE id LIKE $1 OR actor LIKE $1", [like]);
  await p.query("DELETE FROM orga_commitments WHERE actor LIKE $1", [like]);
  await p.query("DELETE FROM orga_messages WHERE conversation_id LIKE $1", [`%${TEST_PREFIX}%`]);
  await p.query("DELETE FROM orga_message_reads WHERE username LIKE $1", [like]);
  // Phase 4.6. Scoped to the prefix like everything else here — these two are
  // created by their own stores' init(), so they may not exist on a first run.
  await p
    .query("DELETE FROM orga_memory_facts WHERE actor LIKE $1", [like])
    .catch(() => {});
  await p
    .query("DELETE FROM orga_token_budget WHERE actor LIKE $1", [like])
    .catch(() => {});
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
    const ok = await changePassword("employee", "employee123", "newpass-99", "priya");
    expect(ok.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 100));

    // Restart → re-configure → new password works
    await configureAccounts(pool());
    const user = verifyCredentials("employee", "newpass-99");
    expect(user).toBeTruthy();
    // Old password fails
    expect(verifyCredentials("employee", "employee123")).toBeNull();

    // Restore for other tests
    await changePassword("employee", "newpass-99", "employee123", "priya");
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

  /**
   * A9's two new facts live inside the day-plan JSONB rather than in columns
   * of their own, so nothing in the schema would have complained if they were
   * silently dropped on the way through. A restart is the only way to see it.
   */
  itIfDb("dropped, part-done and close-out state survive a restart", async () => {
    const { PostgresDayPlanPersistence } = await import("./store-pg-dayplan");
    const p1 = pool();
    const a = new PostgresDayPlanPersistence(p1);
    await a.savePlan({
      actor: "pgtest-a9",
      date: "2026-08-18",
      phase: "planned",
      brief: { changed: [], needsYou: [], atRisk: [] },
      briefStep: 0,
      plan: [
        {
          id: "i1",
          label: "Part done",
          estimateMinutes: 60,
          progressMinutes: 45,
        },
        {
          id: "i2",
          label: "Dropped",
          estimateMinutes: 30,
          dropped: { at: "2026-08-18T14:00:00.000Z", reason: "Not needed" },
        },
        {
          id: "i3",
          label: "Carried over",
          estimateMinutes: 30,
          carriedOver: { at: "2026-08-18T18:00:00.000Z" },
        },
      ],
      meetings: [],
      streak: { clean: 1, bestClean: 1, dayPlanned: 1 },
      seeded: ["Part done", "Carried over"],
      closeOut: { startedAt: "2026-08-18T18:00:00.000Z", finishedAt: "2026-08-18T18:02:00.000Z" },
    });

    const b = new PostgresDayPlanPersistence(pool());
    const plan = await b.loadPlan("pgtest-a9", "2026-08-18");
    expect(plan?.plan[0].progressMinutes).toBe(45);
    expect(plan?.plan[1].dropped).toEqual({
      at: "2026-08-18T14:00:00.000Z",
      reason: "Not needed",
    });
    expect(plan?.plan[2].carriedOver?.at).toBe("2026-08-18T18:00:00.000Z");
    expect(plan?.seeded).toEqual(["Part done", "Carried over"]);
    expect(plan?.closeOut?.finishedAt).toBe("2026-08-18T18:02:00.000Z");

    // And the derived numbers still read correctly off the hydrated plan.
    expect(summariseDay(plan!)).toMatchObject({
      committed: 3,
      done: 0,
      dropped: 1,
      // 15m left on the part-done item, 30m on the carried-over one; the
      // dropped one owes nothing.
      shortfallMinutes: 45,
    });

    await p1.query("DELETE FROM orga_day_plans WHERE actor=$1", ["pgtest-a9"]);
    await p1.query("DELETE FROM orga_day_streaks WHERE actor=$1", ["pgtest-a9"]);
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

describe("orga_conversations — the conversation follows the person", { skip: !DATABASE_URL }, () => {
  itIfDb("a long conversation round-trips through a restart, already trimmed", async () => {
    const { PostgresConversationStore } = await import("./store-pg-conversations");
    const { ConversationStore, MAX_TURNS } = await import("@/domains/assistant/conversation");
    const p1 = pool();

    // Feature 07: it has to survive the process, not just the page.
    const before = new ConversationStore(new PostgresConversationStore(p1));
    const id = `${TEST_PREFIX}conv1`;
    for (let i = 0; i < 30; i += 1) {
      await before.append(id, `${TEST_PREFIX}actor`, [
        { role: "user", content: `question ${i}` },
        { role: "assistant", content: `answer ${i}` },
      ]);
    }
    // Writes are chained per conversation, so this waits for the real last one
    // rather than guessing at a sleep.
    await before.flush(id);

    const after = new ConversationStore(new PostgresConversationStore(pool()));
    const restored = await after.load(id);
    expect(restored?.actor).toBe(`${TEST_PREFIX}actor`);

    // Trimmed on the way in, so the stored history is bounded rather than
    // growing without limit and being re-sent on every question.
    //
    // The note is found by its PREFIX, not by its role. It was a `system`
    // message until Phase 4.6 found -- live, on the twenty-first turn of the
    // first real conversation this product has ever had -- that the provider
    // refuses one inside `messages`. It is a labelled `user` message now, so
    // a role test would count it as a real turn and read 21.
    const isNote = (m: { content: unknown }) =>
      typeof m.content === "string" && m.content.startsWith("Earlier in this conversation");
    const real = (restored?.messages ?? []).filter((m) => !isNote(m));
    expect(real.length).toBeLessThanOrEqual(MAX_TURNS);
    // The most recent exchange survived intact.
    expect(JSON.stringify(restored?.messages)).toContain("question 29");
    // And what fell off is summarised rather than silently forgotten.
    const note = (restored?.messages ?? []).find(isNote);
    expect(JSON.stringify(note)).toContain("Earlier in this conversation");
    // Nothing the provider refuses ever reaches a stored history either.
    expect((restored?.messages ?? []).filter((m) => m.role === "system")).toEqual([]);

    await p1.query("DELETE FROM orga_conversations WHERE id=$1", [id]);
    await p1.end();
  });

  itIfDb("one person's conversation id is not a way into another's history", async () => {
    const { PostgresConversationStore } = await import("./store-pg-conversations");
    const { ConversationStore } = await import("@/domains/assistant/conversation");
    const p1 = pool();
    const store = new ConversationStore(new PostgresConversationStore(p1));
    const id = `${TEST_PREFIX}shared`;
    await store.append(id, `${TEST_PREFIX}alice`, [{ role: "user", content: "alice secret" }]);
    // Bob guesses the id. He gets nothing, and does not overwrite her history.
    expect(await store.historyFor(id, `${TEST_PREFIX}bob`)).toEqual([]);
    await p1.query("DELETE FROM orga_conversations WHERE id=$1", [id]);
    await p1.end();
  });
});

describe("orga_memory_facts — what it remembers outlives the process", { skip: !DATABASE_URL }, () => {
  itIfDb("a fact survives a restart, and building the store hydrates it", async () => {
    const { PostgresMemoryStore } = await import("./store-pg-memory");
    const { MemoryStore } = await import("@/domains/assistant/memory/store");
    const p1 = pool();
    const actor = `${TEST_PREFIX}mem`;

    const before = await MemoryStore.create(new PostgresMemoryStore(p1));
    const kept = await before.remember({
      actor,
      domain: "day",
      text: "I prefer afternoon reviews",
    });
    await before.flush(kept.id);

    // ⚠ The restart, and the thing `CommitmentStore.create` exists to make
    // impossible: a durable store that was never hydrated. `create` does both.
    const after = await MemoryStore.create(new PostgresMemoryStore(pool()), [actor]);
    expect((await after.recall(actor, { today: "2026-08-26" })).map((f) => f.text)).toEqual([
      "I prefer afternoon reviews",
    ]);

    await p1.query("DELETE FROM orga_memory_facts WHERE actor=$1", [actor]);
    await p1.end();
  });

  itIfDb("⚠ a retired fact is still in the table, and still not returned", async () => {
    const { PostgresMemoryStore } = await import("./store-pg-memory");
    const { MemoryStore } = await import("@/domains/assistant/memory/store");
    const p1 = pool();
    const actor = `${TEST_PREFIX}retire`;

    const store = await MemoryStore.create(new PostgresMemoryStore(p1));
    const fact = await store.remember({ actor, domain: "day", text: "morning reviews" });
    await store.flush(fact.id);
    await store.retire(actor, fact.id);
    await store.flush(fact.id);

    // Feature 05: everything is recorded. The row is there...
    const rows = await p1.query(
      "SELECT text, retired_at FROM orga_memory_facts WHERE actor=$1",
      [actor],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].retired_at).not.toBeNull();

    // ...and a fresh process still does not hand it back.
    const after = await MemoryStore.create(new PostgresMemoryStore(pool()), [actor]);
    expect(await after.recall(actor, { today: "2026-08-26" })).toEqual([]);

    await p1.query("DELETE FROM orga_memory_facts WHERE actor=$1", [actor]);
    await p1.end();
  });

  itIfDb("⚠ the (actor, domain) index is USED, not merely present", async () => {
    const { PostgresMemoryStore } = await import("./store-pg-memory");
    const p1 = pool();
    const store = new PostgresMemoryStore(p1);
    // Touch it once so init() has definitely run before EXPLAIN.
    await store.loadFor(`${TEST_PREFIX}explain`);

    // ⚠ A small table is a SEQUENTIAL SCAN whatever indexes exist — Postgres is
    // right to ignore an index over forty rows, so an EXPLAIN against a nearly
    // empty table proves nothing at all. Disabling the alternative is what
    // makes this a question about the index rather than about the row count.
    //
    // ⚠⚠ AND IT MUST BE INSIDE A TRANSACTION, ON ONE CONNECTION.
    //
    // `SET LOCAL` outside a transaction is a **no-op** — Postgres accepts it,
    // warns, and changes nothing — and `pool.query` is free to run the EXPLAIN
    // on a different connection from the SET in any case. So the guard never
    // applied, and this test was really asking "does this table have enough
    // rows to be worth an index today?". It passed while earlier runs had left
    // rows behind and failed once they were cleaned up, which is the worst
    // possible failure schedule for a test nobody was suspecting.
    //
    // Proved before changing it:
    //   no guard         -> Seq Scan
    //   after SET LOCAL  -> Seq Scan          (the no-op)
    //   inside BEGIN     -> Index Scan using orga_memory_facts_actor
    const client = await p1.connect();
    let text: string;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      const plan = await client.query(
        "EXPLAIN SELECT id FROM orga_memory_facts WHERE actor = $1 AND domain = $2",
        [`${TEST_PREFIX}explain`, "day"],
      );
      text = plan.rows.map((r) => r["QUERY PLAN"]).join(" | ");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect(text, `the planner chose: ${text}`).toContain("orga_memory_facts_actor");

    await p1.end();
  });

  itIfDb("⚠ actor comes first in the index — a table keyed by record discloses records", async () => {
    const p1 = pool();
    const res = await p1.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = $1",
      ["orga_memory_facts_actor"],
    );
    expect(res.rows[0]?.indexdef).toMatch(/\(actor,\s*domain\)/);
    await p1.end();
  });
});

describe("orga_token_budget — the ceiling survives a restart", { skip: !DATABASE_URL }, () => {
  itIfDb("⚠ two processes share one budget, and it ADDS rather than taking GREATEST", async () => {
    const { PostgresTokenBudgetStore } = await import("./store-pg-token-budget");
    const p1 = pool();
    const actor = `${TEST_PREFIX}tokens`;
    const date = "2026-08-26";

    // Server A and server B, each with its own store over the same table.
    const a = new PostgresTokenBudgetStore(p1);
    const b = new PostgresTokenBudgetStore(pool());
    await a.add(actor, date, 100_000);
    await b.add(actor, date, 100_000);

    // Under GREATEST this would read 100,000 and half the spend would vanish —
    // which is exactly the multiplying ceiling this table exists to fix.
    expect(await a.spentOn(actor, date)).toBe(200_000);

    // A third process — a restart — sees it too. This is the documented
    // behaviour change: a restart no longer forgives the budget.
    const c = new PostgresTokenBudgetStore(pool());
    expect(await c.spentOn(actor, date)).toBe(200_000);

    // Yesterday is a different row, and it is never deleted.
    expect(await c.spentOn(actor, "2026-08-25")).toBe(0);

    await p1.query("DELETE FROM orga_token_budget WHERE actor=$1", [actor]);
    await p1.end();
  });
});

describe("orga_commitments — a promise outlives the process", { skip: !DATABASE_URL }, () => {
  itIfDb("a commitment survives a restart, and building the store hydrates it", async () => {
    const { PostgresCommitmentStore } = await import("./store-pg-commitments");
    const { CommitmentStore } = await import("@/domains/assistant/commitments/store");
    const p1 = pool();
    const actor = `${TEST_PREFIX}james`;

    const before = await CommitmentStore.create(new PostgresCommitmentStore(p1), [actor]);
    const c = await before.record({
      actor,
      what: "the Priya review",
      dueDate: "2026-08-13",
      conversationId: "conv-1",
    });
    await before.flush(c.id);

    // A commitment that does not survive a restart is worse than none: somebody
    // asked to be reminded, was told it was noted, and never heard again.
    const after = await CommitmentStore.create(new PostgresCommitmentStore(pool()), [actor]);
    const due = await after.dueBy(actor, "2026-08-13");
    expect(due.map((x) => x.what)).toEqual(["the Priya review"]);
    expect(due[0].conversationId).toBe("conv-1");

    // And a discharge sticks too.
    await after.discharge(actor, due[0].id, "done");
    await after.flush(due[0].id);
    const later = await CommitmentStore.create(new PostgresCommitmentStore(pool()), [actor]);
    expect(await later.dueBy(actor, "2026-08-13")).toHaveLength(0);

    await p1.query("DELETE FROM orga_commitments WHERE actor=$1", [actor]);
    await p1.end();
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

describe("a meeting against a real database", { skip: !DATABASE_URL }, () => {
  /**
   * The three things only a real database can show — plan section 2.5, prompt 8.
   *
   * ── Why this points the WORLD at the test database ──────────────────────
   *
   * Everything above drives the stores directly. These cannot: the meeting
   * handlers close over the graph they were registered with, so writing a real
   * meeting through the real spine means building the world against Postgres.
   *
   * `buildDemoWorld()` reads `DATABASE_URL`, so it is set to
   * `ORG_TEST_DATABASE_URL` for the duration and restored afterwards. That is
   * safe for exactly the reason this file opens with: the module-level guard
   * has already refused to run at all if those two are the same string, so the
   * value being assigned here is provably NOT the application's own database.
   *
   * Rows written here are named by the handlers (`meeting_…`, `cal_…`,
   * `booking_…`), which the `TEST_PREFIX` cleanup does not match, so every test
   * deletes the exact ids it created.
   */
  async function withPgWorld<T>(
    fn: (world: Awaited<ReturnType<typeof buildDemoWorld>>) => Promise<T>,
  ): Promise<T> {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = DATABASE_URL;
    resetEnvCache();
    try {
      return await fn(await buildDemoWorld());
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
      resetEnvCache();
    }
  }

  async function scrub(ids: {
    meetingId?: string;
    entryId?: string;
    bookingId?: string;
    activityId?: string;
  }): Promise<void> {
    const p = pool();
    for (const id of [ids.meetingId, ids.entryId, ids.bookingId]) {
      if (!id) continue;
      await p.query("DELETE FROM orga_edges WHERE from_id=$1 OR to_id=$1", [id]);
      await p.query("DELETE FROM orga_nodes WHERE id=$1", [id]);
    }
    if (ids.activityId) await p.query("DELETE FROM orga_activity WHERE id=$1", [ids.activityId]);
    await p.end();
  }

  itIfDb("the provider id and the link survive a restart", async () => {
    const ids = await withPgWorld(async ({ spine, deps }) => {
      const created = await spine.submit(
        adapters.fromForm({
          actor: "james",
          name: "meeting.create",
          args: {
            title: "Durable review",
            kind: "both",
            from: "2027-01-05T15:00:00Z",
            to: "2027-01-05T16:00:00Z",
            attendees: ["priya"],
          },
        }),
      );
      expect(created.status).toBe("ran");
      const response = created.result?.response as {
        meetingId: string;
        entryId: string;
        bookingId?: string;
        link?: string;
        providerMeetingId?: string;
      };

      // A brand-new store over the same database — nothing in memory carries
      // over, which is the whole point.
      const fresh = new PostgresRecordStore(pool());
      const record = (await fresh.getNode("meeting", response.meetingId))?.data as {
        link?: string;
        providerMeetingId?: string;
        linkId?: string;
      };
      expect(record.link).toBe(response.link);
      // ⚠ The field cancel depends on. If this does not survive, cancelling a
      // meeting after a restart can never end its link.
      expect(record.providerMeetingId).toBe(response.providerMeetingId);
      expect(record.providerMeetingId).toBeTruthy();
      expect(record.providerMeetingId).not.toBe(record.linkId);

      // The edge from section 6, read back from Postgres rather than memory.
      const edges = await fresh.edgesOf(response.meetingId, "out");
      expect(edges.some((e) => e.to === response.entryId && e.type === "shown-on")).toBe(true);
      expect(await fresh.getNode("calendar-entry", response.entryId)).toBeTruthy();

      void deps;
      return {
        meetingId: response.meetingId,
        entryId: response.entryId,
        bookingId: response.bookingId,
        activityId: created.activityEntry!.id,
      };
    });
    await scrub(ids);
  });

  itIfDb("the undo plan replays from the activity entry with the closure gone", async () => {
    const ids = await withPgWorld(async ({ spine, deps }) => {
      const created = await spine.submit(
        adapters.fromForm({
          actor: "james",
          name: "meeting.create",
          args: {
            title: "Undo me",
            kind: "both",
            from: "2027-01-06T15:00:00Z",
            to: "2027-01-06T16:00:00Z",
            attendees: ["priya"],
          },
        }),
      );
      const { meetingId, entryId, bookingId } = created.result?.response as {
        meetingId: string;
        entryId: string;
        bookingId?: string;
      };
      const activityId = created.activityEntry!.id;

      // The plan is on the row, not just in the object handed back.
      const p = pool();
      const row = await p.query("SELECT data FROM orga_activity WHERE id=$1", [activityId]);
      await p.end();
      const stored = row.rows[0]?.data as { undoPlan?: unknown[] };
      expect(stored.undoPlan?.length).toBeGreaterThan(0);

      // A fresh log AND a fresh spine: the in-process undo map is empty, so
      // only the persisted plan can do this. This is the case the whole
      // `UndoInfo.plan` mechanism exists for.
      const freshGraph = new PostgresRecordStore(pool());
      const freshLog = new PostgresActivityLog(pool());
      const restarted = new Spine({ ...deps, graph: freshGraph, log: freshLog });
      const replayed = await restarted.undo(activityId, "james");
      expect(replayed.status).toBe("undone");

      expect(await freshGraph.getNode("meeting", meetingId)).toBeUndefined();
      expect(await freshGraph.getNode("calendar-entry", entryId)).toBeUndefined();
      if (bookingId) expect(await freshGraph.getNode("booking", bookingId)).toBeUndefined();
      expect(await freshGraph.edgesOf(meetingId, "out")).toEqual([]);

      return { meetingId, entryId, bookingId, activityId };
    });
    await scrub(ids);
  });
});

describe("orga_proposals — a prepared operation is shared between instances", { skip: !DATABASE_URL }, () => {
  /**
   * ── ⚠ What this is actually for ─────────────────────────────────────────
   *
   * NOT surviving a restart. `propose.ts` argues, correctly, that losing a
   * proposal to a restart is fine — the person is asked again against facts
   * that were re-read, and the ten-minute expiry means nothing survives the
   * night either way.
   *
   * It is for the SECOND instance. A voice session on instance A prepares an
   * approval and puts it on the person's screen; the tap is an ordinary HTTP
   * request that the load balancer may send to instance B, which has never
   * held it. Nothing unsafe happens — the tap is refused — but the Approve
   * button fails depending on which instance answers.
   *
   * So each test below builds **two independent stores over one database**,
   * which is what two instances actually are.
   */
  const makeProposal = (id: string, actor: string, over: Partial<Record<string, unknown>> = {}) => ({
    id,
    actor,
    opName: "leave.approve",
    args: { leaveId: `${TEST_PREFIX}-leave` },
    summary: "approve a leave request",
    expiresAt: Date.now() + 60_000,
    turnId: "turn_1_123",
    ...over,
  });

  async function stores() {
    const { PostgresProposalStore } = await import("./store-pg-proposals");
    const a = pool();
    const b = pool();
    return {
      a: new PostgresProposalStore(a),
      b: new PostgresProposalStore(b),
      end: async () => {
        await a.query("DELETE FROM orga_proposals WHERE id LIKE $1", [`${TEST_PREFIX}%`]);
        await a.end();
        await b.end();
      },
    };
  }

  itIfDb("⚠ prepared on one instance, found by another", async () => {
    const { a, b, end } = await stores();
    await a.put(makeProposal(`${TEST_PREFIX}-p1`, `${TEST_PREFIX}shruti`));

    // B has never seen it, and must still find it — this is the whole point.
    const seen = await b.get(`${TEST_PREFIX}-p1`);
    expect(seen?.opName).toBe("leave.approve");
    expect(seen?.args).toEqual({ leaveId: `${TEST_PREFIX}-leave` });
    expect(seen?.turnId).toBe("turn_1_123");
    await end();
  });

  itIfDb("⚠ take is ATOMIC — two instances racing, exactly one wins", async () => {
    const { a, b, end } = await stores();
    await a.put(makeProposal(`${TEST_PREFIX}-race`, `${TEST_PREFIX}shruti`));

    // Both taps fire together, as two Approve requests on two instances would.
    // `DELETE ... RETURNING` is one statement, so exactly one gets the row.
    const [first, second] = await Promise.all([
      a.take(`${TEST_PREFIX}-race`),
      b.take(`${TEST_PREFIX}-race`),
    ]);
    const winners = [first, second].filter(Boolean);
    expect(winners, "a prepared approval was taken twice").toHaveLength(1);
    await end();
  });

  itIfDb("openFor is per person, and hides the expired", async () => {
    const { a, b, end } = await stores();
    const now = Date.now();
    await a.put(makeProposal(`${TEST_PREFIX}-mine`, `${TEST_PREFIX}shruti`));
    await a.put(makeProposal(`${TEST_PREFIX}-theirs`, `${TEST_PREFIX}ravi`));
    await a.put(makeProposal(`${TEST_PREFIX}-old`, `${TEST_PREFIX}shruti`, { expiresAt: now - 1 }));

    const mine = await b.openFor(`${TEST_PREFIX}shruti`, now);
    expect(mine.map((p) => p.id)).toEqual([`${TEST_PREFIX}-mine`]);
    await end();
  });

  itIfDb("a taken proposal is gone everywhere, not just where it was taken", async () => {
    const { a, b, end } = await stores();
    await a.put(makeProposal(`${TEST_PREFIX}-once`, `${TEST_PREFIX}shruti`));
    expect(await a.take(`${TEST_PREFIX}-once`)).toBeTruthy();
    expect(await b.get(`${TEST_PREFIX}-once`)).toBeUndefined();
    expect(await b.take(`${TEST_PREFIX}-once`)).toBeUndefined();
    await end();
  });

  itIfDb("the arguments survive the round trip exactly — turn 2 never re-derives them", async () => {
    const { a, b, end } = await stores();
    // Nested, with a number and a null, because the whole guarantee is that
    // what is submitted is what was prepared.
    const args = { leaveId: "lv_1", days: 3, note: null, nested: { by: "shruti", ok: true } };
    await a.put(makeProposal(`${TEST_PREFIX}-args`, `${TEST_PREFIX}shruti`, { args }));
    expect((await b.get(`${TEST_PREFIX}-args`))?.args).toEqual(args);
    await end();
  });
});
