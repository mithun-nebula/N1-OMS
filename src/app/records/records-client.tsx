"use client";

import { useEffect, useState } from "react";
import { isAdminLike, isHrLike } from "@/server/roles";

interface DoctypeEntry {
  doctype: string;
  nodeType: string;
  sensitive: boolean;
}
interface CategoryGroup {
  category: string;
  doctypes: DoctypeEntry[];
}
interface RecordItem {
  id: string;
  data: Record<string, unknown>;
}

const CATEGORY_LABELS: Record<string, string> = {
  payroll: "Payroll & statutory",
  recruitment: "Recruitment & onboarding",
  leave: "Leave (advanced)",
  expense: "Expense & travel",
  attendance: "Attendance & shifts",
  performance: "Performance & appraisal",
  training: "Training",
  lifecycle: "Employee lifecycle",
};

export function RecordsClient({ actorRole }: { actorRole: string }) {
  const [catalog, setCatalog] = useState<CategoryGroup[]>([]);
  const [n1Mode, setN1Mode] = useState<string>("stub");
  const [selected, setSelected] = useState<string>("");
  const [meta, setMeta] = useState<{ doctype?: string; category?: string; sensitive?: boolean } | null>(null);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // detail/edit modal state
  const [editing, setEditing] = useState<RecordItem | null>(null);
  const [editData, setEditData] = useState<Record<string, string>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [createData, setCreateData] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const canManage = isHrLike(actorRole);
  const canDelete = isAdminLike(actorRole);

  useEffect(() => {
    fetch("/api/n1-doctypes")
      .then((r) => r.json())
      .then((d) => {
        setCatalog(d.catalog ?? []);
        setN1Mode(d.n1Mode ?? "stub");
      });
  }, []);

  useEffect(() => {
    if (!selected) return;
    const t = setTimeout(async () => {
      setLoading(true);
      setRecords([]);
      const res = await fetch(`/api/records-list?type=${encodeURIComponent(selected)}`);
      const d = await res.json();
      setRecords(d.records ?? []);
      setMeta({ doctype: d.doctype, category: d.category, sensitive: d.sensitive });
      setLoading(false);
    }, 0);
    return () => clearTimeout(t);
  }, [selected]);

  async function runOp(name: string, args: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: "form", name, args }),
    });
    const data = await res.json();
    setBusy(false);
    return data;
  }

  function refresh() {
    if (selected) {
      fetch(`/api/records-list?type=${encodeURIComponent(selected)}`)
        .then((r) => r.json())
        .then((d) => setRecords(d.records ?? []));
    }
  }

  function openDetail(rec: RecordItem) {
    setEditing(rec);
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec.data)) {
      flat[k] = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    }
    setEditData(flat);
  }

  async function saveEdit() {
    if (!editing || !selected) return;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(editData)) {
      if (v === "") continue;
      const num = Number(v);
      data[k] = Number.isFinite(num) && v !== "" ? num : v === "true" ? true : v === "false" ? false : v;
    }
    const res = await runOp("record.update", { nodeType: selected, nodeId: editing.id, data });
    if (res.status === "ran") {
      setEditing(null);
      refresh();
    }
  }

  async function deleteRecord() {
    if (!editing || !selected) return;
    if (!confirm(`Delete ${editing.id}? This can be undone.`)) return;
    const res = await runOp("record.delete", { nodeType: selected, nodeId: editing.id });
    if (res.status === "ran") {
      setEditing(null);
      refresh();
    }
  }

  async function createRecord() {
    if (!selected) return;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(createData)) {
      if (v === "") continue;
      const num = Number(v);
      data[k] = Number.isFinite(num) && v !== "" ? num : v === "true" ? true : v === "false" ? false : v;
    }
    if (Object.keys(data).length === 0) return;
    const res = await runOp("record.create", { nodeType: selected, data });
    if (res.status === "ran") {
      setShowCreate(false);
      setCreateData({});
      refresh();
    }
  }

  function startCreate() {
    // Pre-fill from first record's keys (blanked) as a template
    const template: Record<string, string> = {};
    if (records.length > 0) {
      for (const k of Object.keys(records[0].data)) template[k] = "";
    } else {
      template.status = "Active";
    }
    setCreateData(template);
    setShowCreate(true);
  }

  function addCreateField() {
    if (!newKey.trim()) return;
    setCreateData({ ...createData, [newKey.trim()]: newValue });
    setNewKey("");
    setNewValue("");
  }

  // The CSV export that used to live here built the file in the browser from
  // records already on the page, so it bypassed `canExport` entirely — and the
  // button rendered for every role, including interns. Exporting is a separate
  // right from viewing (non-negotiable #5), so it cannot be done client-side.
  // If export returns, it goes through /api/export, which asks the gate.

  const columns = records.length > 0 ? pickColumns(records[0].data) : [];

  return (
    <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[18rem_1fr]">
      <aside className="space-y-4">
        <div className="rounded-lg bg-teal-700/10 px-3 py-2 text-xs text-teal-800 dark:text-teal-300">
          N1 mode: <strong>{n1Mode}</strong>
          {n1Mode === "stub" && <span className="block text-[10px] opacity-70">live data needs N1_BASE_URL/KEY/SECRET</span>}
        </div>
        {catalog.map((group) => (
          <div key={group.category}>
            <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-widest text-zinc-400">
              {CATEGORY_LABELS[group.category] ?? group.category}
            </div>
            <div className="space-y-0.5">
              {group.doctypes.map((d) => (
                <button
                  key={d.nodeType}
                  onClick={() => setSelected(d.nodeType)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-xs transition-colors ${
                    selected === d.nodeType
                      ? "bg-teal-700/10 text-teal-700 dark:text-teal-300"
                      : "text-zinc-600 hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
                  }`}
                >
                  <span className="truncate">{d.doctype}</span>
                  {d.sensitive && <span className="ml-1 text-[9px] text-amber-600">🔒</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>

      <section>
        {!selected ? (
          <p className="text-sm text-zinc-400">Select a DocType on the left to browse its records.</p>
        ) : loading ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : records.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-black/[.12] p-8 text-center dark:border-white/[.15]">
            <p className="text-sm text-zinc-500">No <strong>{meta?.doctype}</strong> records available.</p>
            {canManage && (
              <button onClick={startCreate} className="mt-3 rounded-lg bg-teal-700 px-4 py-1.5 text-xs font-medium text-white">
                + Create the first record
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium text-black dark:text-zinc-50">{meta?.doctype}</h2>
              {meta?.sensitive && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">sensitive · HR/admin</span>}
              <span className="text-xs text-zinc-400">{records.length} shown</span>
              {canManage && (
                <button onClick={startCreate} className="ml-auto rounded-lg bg-teal-700 px-3 py-1 text-xs font-medium text-white">
                  + New
                </button>
              )}
            </div>
            <div className="overflow-x-auto rounded-xl border border-black/[.08] dark:border-white/[.12]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/[.08] bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-white/[.1] dark:bg-zinc-900">
                    <th className="px-3 py-2">id</th>
                    {columns.map((c) => (
                      <th key={c} className="px-3 py-2">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => canManage && openDetail(r)}
                      className={`border-b border-black/[.04] last:border-0 dark:border-white/[.04] ${canManage ? "cursor-pointer hover:bg-teal-700/5" : ""}`}
                    >
                      <td className="px-3 py-1.5 font-mono text-[11px] text-zinc-400">{r.id}</td>
                      {columns.map((c) => (
                        <td key={c} className="px-3 py-1.5 text-zinc-600 dark:text-zinc-300">
                          {renderCell(r.data[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Detail / Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setEditing(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 dark:bg-black" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-black dark:text-zinc-50">{meta?.doctype}</h3>
                <p className="font-mono text-xs text-zinc-400">{editing.id}</p>
              </div>
              <div className="flex gap-2">
                {canDelete && (
                  <button onClick={deleteRecord} disabled={busy} className="rounded-lg border border-rose-300 px-3 py-1 text-xs font-medium text-rose-600 disabled:opacity-40">
                    Delete
                  </button>
                )}
                <button onClick={() => setEditing(null)} className="text-xs text-zinc-400">Close</button>
              </div>
            </div>
            <div className="space-y-3">
              {Object.entries(editData).map(([key, val]) => (
                <label key={key} className="block">
                  <span className="text-xs font-medium text-zinc-500">{key}</span>
                  <input
                    value={val}
                    onChange={(e) => setEditData({ ...editData, [key]: e.target.value })}
                    className="mt-0.5 w-full rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={saveEdit} disabled={busy} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                {busy ? "Saving…" : "Save changes"}
              </button>
              <button onClick={() => setEditing(null)} className="text-sm text-zinc-500">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setShowCreate(false)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 dark:bg-black" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-lg font-semibold text-black dark:text-zinc-50">New {meta?.doctype}</h3>
              <button onClick={() => setShowCreate(false)} className="text-xs text-zinc-400">Close</button>
            </div>
            <div className="space-y-3">
              {Object.entries(createData).map(([key, val]) => (
                <label key={key} className="block">
                  <span className="text-xs font-medium text-zinc-500">{key}</span>
                  <input
                    value={val}
                    onChange={(e) => setCreateData({ ...createData, [key]: e.target.value })}
                    className="mt-0.5 w-full rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
                  />
                </label>
              ))}
              {/* Add custom field */}
              <div className="flex gap-2 border-t border-black/[.06] pt-3 dark:border-white/[.06]">
                <input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="field name"
                  className="flex-1 rounded-lg border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
                />
                <input
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="value"
                  className="flex-1 rounded-lg border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
                />
                <button onClick={addCreateField} className="rounded-lg bg-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  Add field
                </button>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={createRecord} disabled={busy} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                {busy ? "Creating…" : "Create record"}
              </button>
              <button onClick={() => setShowCreate(false)} className="text-sm text-zinc-500">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function pickColumns(data: Record<string, unknown>): string[] {
  const preferred = ["employee", "employeeName", "employee_name", "name", "status", "fromDate", "from_date", "date", "postingDate", "posting_date", "amount", "grossPay", "netPay", "leaveType", "leave_type", "title", "applicantName"];
  const keys = Object.keys(data).filter((k) => !k.startsWith("_"));
  const ordered = [...preferred.filter((p) => keys.includes(p)), ...keys.filter((k) => !preferred.includes(k))];
  return ordered.slice(0, 6);
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return "…";
  return String(value);
}
