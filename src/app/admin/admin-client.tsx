"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

const ROLES = ["intern", "employee", "manager", "hr", "admin", "super-admin"];

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
    await fetch(`/api/admin/accounts/${username}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    setAccounts((prev) => prev.map((a) => (a.username === username ? { ...a, role } : a)));
  }

  async function autonomyAction(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    const res = await fetch("/api/autonomy/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.suggestions) setSuggestions(data.suggestions);
    const rulesRes = await fetch("/api/autonomy/rules").then((r) => r.json());
    setRules(rulesRes.rules ?? []);
    setSuggestions(rulesRes.suggestions ?? []);
  }

  async function triggerTick() {
    setBusy(true);
    await fetch("/api/autonomy/tick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-8 p-6">
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Users</h2>
        <div className="overflow-hidden rounded-xl border border-black/[.08] dark:border-white/[.12]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/[.08] bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-white/[.1] dark:bg-zinc-900">
                <th className="px-4 py-2">Username</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Team</th>
                <th className="px-4 py-2">Role</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.username} className="border-b border-black/[.04] last:border-0 dark:border-white/[.04]">
                  <td className="px-4 py-2 font-mono text-xs text-zinc-500">{a.username}</td>
                  <td className="px-4 py-2 font-medium text-black dark:text-zinc-50">{a.displayName}</td>
                  <td className="px-4 py-2 text-zinc-400">{a.team ?? "—"}</td>
                  <td className="px-4 py-2">
                    <select
                      value={a.role}
                      onChange={(e) => changeRole(a.username, e.target.value)}
                      className="rounded border border-black/[.1] bg-white px-2 py-1 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 rounded-xl border border-dashed border-black/[.12] p-4 dark:border-white/[.15]">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-400">Create account</p>
          <div className="flex flex-wrap items-end gap-3">
            <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Name" className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="Username" autoCapitalize="none" className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
            <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Password" type="password" className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} placeholder="Team (optional)" className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
            <button onClick={createAccount} disabled={busy || !form.username || !form.password || !form.displayName} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              Create
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Autonomy rules</h2>
          <div className="flex gap-2">
            <button onClick={() => autonomyAction("detect-routines")} disabled={busy} className="rounded-lg border border-black/[.1] px-3 py-1 text-xs dark:border-white/[.2]">Detect routines</button>
            <button onClick={triggerTick} disabled={busy} className="rounded-lg border border-black/[.1] px-3 py-1 text-xs dark:border-white/[.2]">Trigger tick</button>
          </div>
        </div>
        {rules.length === 0 ? (
          <p className="text-sm text-zinc-400">No standing rules have been exercised yet.</p>
        ) : (
          <div className="space-y-1">
            {rules.map((r) => (
              <div key={r.ruleId} className="flex items-center justify-between rounded-lg bg-zinc-50 px-4 py-2 text-sm dark:bg-zinc-900">
                <div>
                  <span className="font-mono text-xs text-zinc-500">{r.ruleId}</span>
                  <span className="ml-3 text-black dark:text-zinc-100">{r.opName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${r.status === "graduated" ? "bg-teal-100 text-teal-700" : r.status === "suspended" ? "bg-rose-100 text-rose-700" : "bg-zinc-200 text-zinc-500"}`}>
                    {r.status}
                  </span>
                  <span className="text-xs text-zinc-400">{r.cleanCount}/10 clean</span>
                  {r.status === "supervised" && (
                    <button onClick={() => autonomyAction("revoke", { ruleId: r.ruleId })} className="text-xs text-zinc-500 underline">revoke</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Routine suggestions (offer, never auto)</p>
            {suggestions.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg bg-amber-50 px-4 py-2 text-sm dark:bg-amber-950">
                <span>{s.actor} repeats <strong>{s.opName}</strong> ({s.count}×)</span>
                <button onClick={() => autonomyAction("accept-suggestion", { suggestionId: s.id })} className="text-xs text-amber-700 underline">accept</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">System status</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.12]">
            <div className="text-xs text-zinc-400">LLM</div>
            <div className="mt-1 text-sm font-medium text-black dark:text-zinc-50">{initial.modes.llm?.mode}</div>
          </div>
          <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.12]">
            <div className="text-xs text-zinc-400">Video</div>
            <div className="mt-1 text-sm font-medium text-black dark:text-zinc-50">{initial.modes.video?.mode}</div>
          </div>
          <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.12]">
            <div className="text-xs text-zinc-400">N1 (HR)</div>
            <div className="mt-1 text-sm font-medium text-black dark:text-zinc-50">{initial.modes.n1?.mode}</div>
          </div>
          <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.12]">
            <div className="text-xs text-zinc-400">Operations</div>
            <div className="mt-1 text-sm font-medium text-black dark:text-zinc-50">{initial.operations.length}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
