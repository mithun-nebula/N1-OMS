"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Empty, SectionTitle, inputCls } from "../ui/kit";
import { cleanApprovalsToGraduate, neverGraduatesCategory } from "@/spine/gate/autonomy";
import type { OperationCategory } from "@/spine/operation/registry";

interface Account {
  username: string;
  personId: string;
  role: string;
  displayName: string;
  team?: string;
}

interface Rule {
  ruleId: string;
  author: string;
  opName: string;
  category?: OperationCategory;
  status: string;
  cleanCount: number;
}

interface Suggestion {
  id: string;
  actor: string;
  opName: string;
  count: number;
  status: string;
}

/** A small inline outcome message, rendered next to the controls it belongs to. */
interface Notice {
  kind: "success" | "error";
  text: string;
}

const ROLES = ["intern", "employee", "manager", "hr", "admin", "super-admin"];

const GRADUATE_AT = cleanApprovalsToGraduate();

export function AdminClient({
  initial,
}: {
  initial: {
    accounts: Account[];
    rules: Rule[];
    suggestions: Suggestion[];
    modes: { llm: { id: string; mode: string }; video: { id: string; mode: string }; n1: { id: string; mode: string } };
    operations: string[];
  };
}) {
  const router = useRouter();
  const [accounts, setAccounts] = useState(initial.accounts);
  const [rules, setRules] = useState(initial.rules);
  const [suggestions, setSuggestions] = useState(initial.suggestions);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", displayName: "", role: "intern", team: "" });
  const [error, setError] = useState<string | null>(null);
  const [peopleNote, setPeopleNote] = useState<Notice | null>(null);
  const [autonomyNote, setAutonomyNote] = useState<Notice | null>(null);
  const peopleNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Show a note by the people list; successes fade away on their own. */
  function showPeopleNote(note: Notice) {
    if (peopleNoteTimer.current) clearTimeout(peopleNoteTimer.current);
    setPeopleNote(note);
    if (note.kind === "success") {
      peopleNoteTimer.current = setTimeout(() => setPeopleNote(null), 4000);
    }
  }

  async function createAccount() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Failed.");
      return;
    }
    setForm({ username: "", password: "", displayName: "", role: "intern", team: "" });
    const list = await fetch("/api/admin/accounts").then((r) => r.json());
    setAccounts(list.accounts ?? []);
  }

  async function changeRole(username: string, role: string) {
    setPeopleNote(null);
    try {
      const res = await fetch(`/api/admin/accounts/${username}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showPeopleNote({ kind: "error", text: data.error ?? "That role change was refused." });
        return;
      }
      setAccounts((prev) => prev.map((a) => (a.username === username ? { ...a, role } : a)));
    } catch {
      showPeopleNote({ kind: "error", text: "Could not reach the server. The role was not changed." });
    }
  }

  async function resetPassword(username: string) {
    const next = window.prompt(`Reset password for ${username}:`, "newpass123");
    if (!next) return;
    setBusy(true);
    setPeopleNote(null);
    try {
      const res = await fetch(`/api/admin/accounts/${username}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showPeopleNote({ kind: "error", text: data.error ?? "The password was not reset." });
        return;
      }
      showPeopleNote({ kind: "success", text: `Password reset for ${username}.` });
    } catch {
      showPeopleNote({ kind: "error", text: "Could not reach the server. The password was not reset." });
    } finally {
      setBusy(false);
    }
  }

  async function autonomyAction(
    action: string,
    extra: Record<string, unknown> = {},
    notes: { success?: string; refused?: string } = {},
  ) {
    setBusy(true);
    setAutonomyNote(null);
    try {
      const res = await fetch("/api/autonomy/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        suggestions?: unknown;
      };
      if (!res.ok) {
        setAutonomyNote({ kind: "error", text: data.error ?? "That autonomy action failed." });
        return;
      }
      if (data.ok === false) {
        setAutonomyNote({ kind: "error", text: notes.refused ?? "The engine refused that action." });
        return;
      }
      if (Array.isArray(data.suggestions)) setSuggestions(data.suggestions as Suggestion[]);
      setAutonomyNote({
        kind: "success",
        text:
          notes.success ??
          (Array.isArray(data.suggestions)
            ? `Detection ran — ${data.suggestions.length} suggestion${data.suggestions.length === 1 ? "" : "s"} on offer.`
            : "Done."),
      });
      const rulesRes = await fetch("/api/autonomy/rules");
      if (rulesRes.ok) {
        const listing = (await rulesRes.json().catch(() => null)) as {
          rules?: unknown;
          suggestions?: unknown;
        } | null;
        if (listing) {
          if (Array.isArray(listing.rules)) setRules(listing.rules as Rule[]);
          if (Array.isArray(listing.suggestions)) setSuggestions(listing.suggestions as Suggestion[]);
        }
      }
    } catch {
      setAutonomyNote({ kind: "error", text: "Could not reach the server. Nothing changed." });
    } finally {
      setBusy(false);
    }
  }

  async function triggerTick() {
    setBusy(true);
    setAutonomyNote(null);
    try {
      const res = await fetch("/api/autonomy/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; emitted?: number };
      if (!res.ok) {
        setAutonomyNote({ kind: "error", text: data.error ?? "The tick was refused." });
        return;
      }
      setAutonomyNote({
        kind: "success",
        text:
          typeof data.emitted === "number"
            ? `Tick ran — ${data.emitted} operation${data.emitted === 1 ? "" : "s"} emitted.`
            : "Tick ran.",
      });
      router.refresh();
    } catch {
      setAutonomyNote({ kind: "error", text: "Could not reach the server. Nothing changed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      {/* ============ Users ============ */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "60ms" }}>
        <SectionTitle>Users</SectionTitle>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
                <th className="px-3 py-2">Person</th>
                <th className="px-3 py-2">Username</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.username} className="border-t border-line transition-colors hover:bg-raised">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2.5">
                      <Avatar name={a.displayName} size={26} />
                      <span className="text-[13px] font-semibold text-ink">{a.displayName}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-faint">{a.username}</td>
                  <td className="px-3 py-2 text-[13px] text-ink-soft">{a.team ?? "—"}</td>
                  <td className="px-3 py-2">
                    <select
                      value={a.role}
                      onChange={(e) => changeRole(a.username, e.target.value)}
                      className={inputCls}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => resetPassword(a.username)}
                      disabled={busy}
                      className="press text-xs font-medium text-ink-faint transition-colors hover:text-accent-strong disabled:opacity-40"
                    >
                      Reset password
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {peopleNote && (
          <p
            className={`fade-in mt-2 rounded-xl px-3 py-2 text-xs font-medium ${
              peopleNote.kind === "error" ? "bg-danger-soft text-danger" : "bg-mint text-mint-strong"
            }`}
          >
            {peopleNote.text}
          </p>
        )}

        <div className="mt-4 rounded-2xl border border-dashed border-line p-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">Create account</p>
          <div className="flex flex-wrap items-end gap-2.5">
            <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Name" className={`${inputCls} py-2`} />
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="Username" autoCapitalize="none" className={`${inputCls} py-2`} />
            <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Password" type="password" className={`${inputCls} py-2`} />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={`${inputCls} py-2`}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} placeholder="Team (optional)" className={`${inputCls} py-2`} />
            <button
              onClick={createAccount}
              disabled={busy || !form.username || !form.password || !form.displayName}
              className="press rounded-xl bg-accent-strong px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent disabled:opacity-40"
            >
              Create account
            </button>
          </div>
          {error && (
            <p className="fade-in mt-2 rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">{error}</p>
          )}
        </div>
      </section>

      {/* ============ Autonomy rules ============ */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "130ms" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>Autonomy rules</SectionTitle>
          <div className="flex gap-2">
            <button onClick={() => autonomyAction("detect-routines")} disabled={busy} className="press rounded-full bg-raised px-3.5 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:text-ink disabled:opacity-40">
              Detect routines
            </button>
            <button onClick={triggerTick} disabled={busy} className="press rounded-full bg-raised px-3.5 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:text-ink disabled:opacity-40">
              Trigger tick
            </button>
          </div>
        </div>
        {autonomyNote && (
          <p
            className={`fade-in mt-2 rounded-xl px-3 py-2 text-xs font-medium ${
              autonomyNote.kind === "error" ? "bg-danger-soft text-danger" : "bg-mint text-mint-strong"
            }`}
          >
            {autonomyNote.text}
          </p>
        )}
        {rules.length === 0 ? (
          <Empty icon="spark" text="No standing rules have been exercised yet." />
        ) : (
          <div className="mt-3 space-y-1.5">
            {rules.map((r) => (
              <div key={r.ruleId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-raised px-3.5 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-mono text-xs text-ink-faint">{r.ruleId}</span>
                  <span className="ml-3 text-[13px] font-medium text-ink">{r.opName}</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    r.status === "graduated" ? "bg-mint text-mint-strong" : r.status === "suspended" ? "bg-rose text-rose-strong" : "bg-lilac text-lilac-strong"
                  }`}>
                    {r.status}
                  </span>
                  <span className="text-xs text-ink-faint">{r.cleanCount}/{GRADUATE_AT} clean</span>
                  {r.status === "supervised" &&
                    !neverGraduatesCategory(r.category) &&
                    r.cleanCount >= GRADUATE_AT && (
                      <button
                        onClick={() =>
                          autonomyAction(
                            "accept-graduation",
                            { ruleId: r.ruleId },
                            {
                              success: `${r.ruleId} graduated — it now runs on its own.`,
                              refused: "Graduation was refused — only the rule's author can accept it.",
                            },
                          )
                        }
                        disabled={busy}
                        className="press text-xs font-bold text-mint-strong hover:underline disabled:opacity-40"
                      >
                        Let it run on its own
                      </button>
                    )}
                  {r.status === "supervised" && (
                    <button
                      onClick={() =>
                        autonomyAction(
                          "revoke",
                          { ruleId: r.ruleId },
                          { success: `${r.ruleId} returned to supervised.`, refused: "That revoke was refused." },
                        )
                      }
                      disabled={busy}
                      className="press text-xs font-medium text-danger hover:underline disabled:opacity-40"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
              Routine suggestions — offered, never automatic
            </p>
            <div className="space-y-1.5">
              {suggestions.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-xl border-l-[3px] border-peach-strong bg-peach px-3.5 py-2 text-[13px] text-ink">
                  <span>{s.actor} repeats <strong>{s.opName}</strong> ({s.count}×)</span>
                  <button
                    onClick={() =>
                      autonomyAction(
                        "accept-suggestion",
                        { suggestionId: s.id },
                        { success: "Suggestion accepted.", refused: "That suggestion is no longer on offer." },
                      )
                    }
                    disabled={busy}
                    className="press text-xs font-bold text-peach-strong hover:underline disabled:opacity-40"
                  >
                    Accept
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <ActivityLogViewer />

      {/* ============ System status ============ */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "260ms" }}>
        <SectionTitle>System status</SectionTitle>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatusTile label="LLM" value={initial.modes.llm?.mode} />
          <StatusTile label="Video" value={initial.modes.video?.mode} />
          <StatusTile label="N1 (HR)" value={initial.modes.n1?.mode} />
          <StatusTile label="Operations" value={String(initial.operations.length)} />
        </div>
      </section>
    </div>
  );
}

function StatusTile({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-2xl bg-raised px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">{label}</div>
      <div className="mt-1 flex items-center gap-1.5 text-sm font-bold text-ink">
        <span className={`h-2 w-2 rounded-full ${value === "live" ? "bg-mint-strong" : "bg-peach-strong"}`} />
        {value ?? "—"}
      </div>
    </div>
  );
}

interface ActivityEntry {
  id: string;
  operationName: string;
  actor: string;
  at: string;
  outcome: string;
}

function ActivityLogViewer() {
  const [filters, setFilters] = useState({ actor: "", operation: "" });
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  async function load() {
    const params = new URLSearchParams();
    if (filters.actor) params.set("actor", filters.actor);
    if (filters.operation) params.set("operation", filters.operation);
    params.set("limit", "50");
    try {
      const res = await fetch(`/api/activity?${params.toString()}`);
      if (!res.ok) throw new Error(`activity load failed (${res.status})`);
      const data = (await res.json()) as { entries?: ActivityEntry[] };
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setLoadFailed(false);
    } catch {
      setEntries([]);
      setLoadFailed(true);
    }
    setLoaded(true);
  }

  return (
    <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "195ms" }}>
      <SectionTitle>Activity log</SectionTitle>
      <div className="mt-3 flex flex-wrap gap-2">
        <input value={filters.actor} onChange={(e) => setFilters({ ...filters, actor: e.target.value })} placeholder="Filter by actor" className={inputCls} />
        <input value={filters.operation} onChange={(e) => setFilters({ ...filters, operation: e.target.value })} placeholder="Filter by operation (e.g. leave)" className={inputCls} />
        <button onClick={load} className="press rounded-xl bg-chrome px-3.5 py-1.5 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card">
          Load entries
        </button>
      </div>
      {!loaded ? (
        <p className="mt-3 text-xs text-ink-faint">Load to fetch the recent activity log.</p>
      ) : loadFailed ? (
        <p className="fade-in mt-3 rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
          {"Couldn't load the log."}
        </p>
      ) : entries.length === 0 ? (
        <Empty icon="search" text="No entries match those filters." />
      ) : (
        <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between rounded-xl bg-raised px-3 py-1.5 text-xs">
              <span className="min-w-0 truncate text-ink-soft">
                <span className="font-mono text-ink-faint">{e.operationName}</span> · {e.actor}
              </span>
              <span className="shrink-0 text-ink-faint">{new Date(e.at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
