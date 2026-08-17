"use client";

import { useEffect, useState } from "react";
import { isAdminLike, isHrLike } from "@/server/roles";
import { Empty, Modal, OpFeedback, inputCls } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";

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
  const op = useOperation();
  const busy = op.busy;

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
    return op.run(name, args, { refresh: false });
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
    <div className="grid grid-cols-1 gap-5 p-4 sm:p-6 lg:grid-cols-[18rem_1fr]">
      <aside className="rise space-y-4" style={{ animationDelay: "60ms" }}>
        <div className="rounded-2xl border-l-[3px] border-accent-strong bg-accent-soft px-3.5 py-2.5 text-xs text-accent-ink">
          N1 mode: <strong>{n1Mode}</strong>
          {n1Mode === "stub" && <span className="block text-[10px] opacity-70">live data needs N1_BASE_URL/KEY/SECRET</span>}
        </div>
        {catalog.map((group) => (
          <div key={group.category}>
            <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
              {CATEGORY_LABELS[group.category] ?? group.category}
            </div>
            <div className="space-y-0.5">
              {group.doctypes.map((d) => (
                <button
                  key={d.nodeType}
                  onClick={() => setSelected(d.nodeType)}
                  className={`press flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left text-xs font-medium transition-colors ${
                    selected === d.nodeType
                      ? "bg-accent-soft text-accent-ink"
                      : "text-ink-soft hover:bg-raised hover:text-ink"
                  }`}
                >
                  <span className="truncate">{d.doctype}</span>
                  {d.sensitive && <span className="ml-1 text-[9px]">🔒</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>

      <section className="rise" style={{ animationDelay: "120ms" }}>
        {!selected ? (
          <Empty icon="search" text="Select a DocType on the left to browse its records." />
        ) : loading ? (
          <p className="fade-in text-sm text-ink-faint">Loading…</p>
        ) : records.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-line p-8 text-center">
            <p className="text-sm text-ink-soft">No <strong>{meta?.doctype}</strong> records available.</p>
            {canManage && (
              <button onClick={startCreate} className="press mt-3 rounded-full bg-chrome px-4 py-2 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card">
                + Create the first record
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-ink">{meta?.doctype}</h2>
              {meta?.sensitive && <span className="rounded-full bg-peach px-2 py-0.5 text-[10px] font-bold text-peach-strong">sensitive · HR/admin</span>}
              <span className="text-xs text-ink-faint">{records.length} shown</span>
              {canManage && (
                <button onClick={startCreate} className="press ml-auto rounded-full bg-chrome px-3.5 py-1.5 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card">
                  + New record
                </button>
              )}
            </div>
            <div className="overflow-x-auto rounded-3xl bg-surface p-3 shadow-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
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
                      className={`border-t border-line transition-colors ${canManage ? "cursor-pointer hover:bg-raised" : ""}`}
                    >
                      <td className="px-3 py-1.5 font-mono text-[11px] text-ink-faint">{r.id}</td>
                      {columns.map((c) => (
                        <td key={c} className="px-3 py-1.5 text-[13px] text-ink-soft">
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
        <Modal onClose={() => setEditing(null)}>
          <div>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-extrabold text-ink">{meta?.doctype}</h3>
                <p className="font-mono text-xs text-ink-faint">{editing.id}</p>
              </div>
              <div className="flex gap-2">
                {canDelete && (
                  <button onClick={deleteRecord} disabled={busy} className="press rounded-full bg-danger-soft px-3 py-1 text-xs font-semibold text-danger disabled:opacity-40">
                    Delete
                  </button>
                )}
                <button onClick={() => setEditing(null)} className="press text-xs font-medium text-ink-faint hover:text-ink">Close</button>
              </div>
            </div>
            <div className="space-y-3">
              {Object.entries(editData).map(([key, val]) => (
                <label key={key} className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">{key}</span>
                  <input
                    value={val}
                    onChange={(e) => setEditData({ ...editData, [key]: e.target.value })}
                    className={`${inputCls} mt-0.5 w-full`}
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button onClick={saveEdit} disabled={busy} className="press rounded-xl bg-chrome px-4 py-2 text-sm font-semibold text-chrome-ink disabled:opacity-40">
                {busy ? "Saving…" : "Save changes"}
              </button>
              <button onClick={() => setEditing(null)} className="text-sm font-medium text-ink-faint hover:text-ink">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create modal */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <div>
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-lg font-extrabold text-ink">New {meta?.doctype}</h3>
              <button onClick={() => setShowCreate(false)} className="press text-xs font-medium text-ink-faint hover:text-ink">Close</button>
            </div>
            <div className="space-y-3">
              {Object.entries(createData).map(([key, val]) => (
                <label key={key} className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">{key}</span>
                  <input
                    value={val}
                    onChange={(e) => setCreateData({ ...createData, [key]: e.target.value })}
                    className={`${inputCls} mt-0.5 w-full`}
                  />
                </label>
              ))}
              {/* Add custom field */}
              <div className="flex gap-2 border-t border-line pt-3">
                <input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="field name"
                  className={`${inputCls} flex-1`}
                />
                <input
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="value"
                  className={`${inputCls} flex-1`}
                />
                <button onClick={addCreateField} className="press rounded-xl bg-raised px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:text-ink">
                  Add field
                </button>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button onClick={createRecord} disabled={busy} className="press rounded-xl bg-accent-strong px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent disabled:opacity-40">
                {busy ? "Creating…" : "Create record"}
              </button>
              <button onClick={() => setShowCreate(false)} className="text-sm font-medium text-ink-faint hover:text-ink">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      <OpFeedback
        error={op.error}
        confirmation={op.confirmation}
        busy={op.busy}
        onConfirm={() => op.confirm()}
        onCancel={op.cancel}
        onDismiss={op.reset}
      />
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
