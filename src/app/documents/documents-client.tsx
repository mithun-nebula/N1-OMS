"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface DocItem {
  id: string;
  name: string;
  nodeType: string;
  nodeId: string;
  version: number;
  required: boolean;
  requiredBy?: string;
  expiresOn?: string;
  roleAccess: string[];
}

export function DocumentsClient({
  documents,
  expiring,
  actorRole,
}: {
  documents: DocItem[];
  expiring: Array<{ id: string; name: string; expiresOn: string; daysLeft: number }>;
  actorRole: string;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    nodeType: "employee",
    nodeId: "",
    contentType: "application/pdf",
    blobRef: "",
    required: false,
    expiresOn: "",
  });

  const canStore = ["super-admin", "admin", "hr", "manager"].includes(actorRole);

  async function store() {
    if (!form.name || !form.nodeType || !form.nodeId) return;
    setBusy(true);
    const res = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: "form",
        name: "document.store",
        args: {
          name: form.name,
          nodeType: form.nodeType,
          nodeId: form.nodeId,
          contentType: form.contentType,
          blobRef: form.blobRef || undefined,
          required: form.required || undefined,
          expiresOn: form.expiresOn || undefined,
        },
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.status === "ran") {
      setShowForm(false);
      setForm({ ...form, name: "", nodeId: "", blobRef: "", expiresOn: "" });
      router.refresh();
    }
  }

  return (
    <div className="space-y-6 p-6">
      {expiring.length > 0 && (
        <section className="rounded-2xl border border-rose-300 bg-rose-50 p-5 dark:border-rose-900 dark:bg-rose-950">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-rose-700 dark:text-rose-400">
            Expiring within 30 days
          </h2>
          <div className="space-y-1">
            {expiring.map((e) => (
              <div key={e.id} className="text-sm text-rose-800 dark:text-rose-200">
                {e.name} — expires {e.expiresOn} ({e.daysLeft} day{e.daysLeft === 1 ? "" : "s"})
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">All documents</h2>
          {canStore && (
            <button onClick={() => setShowForm(!showForm)} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white">
              {showForm ? "Close" : "+ File document"}
            </button>
          )}
        </div>

        {showForm && (
          <div className="mb-4 space-y-3 rounded-xl border border-dashed border-black/[.12] p-4 dark:border-white/[.15]">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Document name" className="rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
              <select value={form.nodeType} onChange={(e) => setForm({ ...form, nodeType: e.target.value })} className="rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50">
                <option value="employee">Employee</option>
                <option value="course">Course</option>
                <option value="event">Event</option>
              </select>
              <input value={form.nodeId} onChange={(e) => setForm({ ...form, nodeId: e.target.value })} placeholder="Record id (e.g. priya)" className="rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
              <input value={form.blobRef} onChange={(e) => setForm({ ...form, blobRef: e.target.value })} placeholder="Blob ref (cloud storage deferred)" className="rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
              <input type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} className="rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
              <label className="flex items-center gap-2 text-sm text-zinc-500">
                <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} className="accent-teal-700" />
                Required document
              </label>
            </div>
            <button onClick={store} disabled={busy || !form.name || !form.nodeId} className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black">Store</button>
          </div>
        )}

        {documents.length === 0 ? (
          <p className="text-sm text-zinc-400">No documents filed yet.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-black/[.06] dark:border-white/[.08]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[.06] bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-white/[.1] dark:bg-zinc-900">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">On record</th>
                  <th className="px-4 py-2">Version</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Access</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id} className="border-b border-black/[.04] last:border-0 dark:border-white/[.04]">
                    <td className="px-4 py-2 font-medium text-black dark:text-zinc-50">{d.name}</td>
                    <td className="px-4 py-2 text-zinc-500">{d.nodeType}:{d.nodeId}</td>
                    <td className="px-4 py-2 text-zinc-500">v{d.version}</td>
                    <td className="px-4 py-2">
                      {d.required && d.version === 0 ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">Required · missing</span>
                      ) : d.required ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Required · supplied</span>
                      ) : d.expiresOn ? (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">Expires {d.expiresOn}</span>
                      ) : (
                        <span className="text-xs text-zinc-400">supplied</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-400">{d.roleAccess.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
