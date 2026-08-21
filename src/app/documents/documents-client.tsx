"use client";

import { useState } from "react";
import { isManagerOrAbove } from "@/server/roles";
import { AccentButton, ChromeButton, Empty, inputCls, OpFeedback, SectionTitle } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";

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
  const op = useOperation();
  const busy = op.busy;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    nodeType: "employee",
    nodeId: "",
    contentType: "application/pdf",
    blobRef: "",
    required: false,
    expiresOn: "",
  });

  const canStore = isManagerOrAbove(actorRole);
  const [requireForm, setRequireForm] = useState({ name: "", nodeType: "employee", nodeId: "" });

  async function markRequired() {
    if (!requireForm.name || !requireForm.nodeId) return;
    const outcome = await op.run("document.require", {
      name: requireForm.name,
      nodeType: requireForm.nodeType,
      nodeId: requireForm.nodeId,
    });
    if (outcome.status === "ran") {
      setRequireForm({ ...requireForm, name: "", nodeId: "" });
    }
  }

  async function store() {
    if (!form.name || !form.nodeType || !form.nodeId) return;
    const outcome = await op.run("document.store", {
      name: form.name,
      nodeType: form.nodeType,
      nodeId: form.nodeId,
      contentType: form.contentType,
      blobRef: form.blobRef || undefined,
      required: form.required || undefined,
      expiresOn: form.expiresOn || undefined,
    });
    if (outcome.status === "ran") {
      setShowForm(false);
      setForm({ ...form, name: "", nodeId: "", blobRef: "", expiresOn: "" });
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      {/* Expiry warning — rose "needs attention" card. */}
      {expiring.length > 0 && (
        <section
          className="rise rounded-3xl border-l-[3px] border-rose-strong bg-rose p-5 shadow-card"
          style={{ animationDelay: "60ms" }}
        >
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-rose-strong">
            Expiring within 30 days
          </h2>
          <div className="mt-3 space-y-2">
            {expiring.map((e, i) => (
              <div
                key={e.id}
                className="rise flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface/80 px-3.5 py-2.5"
                style={{ animationDelay: `${100 + i * 50}ms` }}
              >
                <span className="text-[13px] font-semibold text-ink">{e.name}</span>
                <span className="text-[11px] text-ink-soft">
                  expires {e.expiresOn}
                  <span className="ml-2 rounded-full bg-rose px-2 py-0.5 text-[10px] font-bold text-rose-strong">
                    {e.daysLeft} day{e.daysLeft === 1 ? "" : "s"} left
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Register. */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "130ms" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle>All documents</SectionTitle>
          {canStore && (
            <ChromeButton onClick={() => setShowForm(!showForm)}>
              {showForm ? "Close" : "+ File document"}
            </ChromeButton>
          )}
        </div>

        {showForm && (
          <div className="pop-in mt-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Document name"
                className={`${inputCls} w-full py-2`}
              />
              <select
                value={form.nodeType}
                onChange={(e) => setForm({ ...form, nodeType: e.target.value })}
                className={`${inputCls} w-full py-2`}
              >
                <option value="employee">Employee</option>
                <option value="course">Course</option>
                <option value="event">Event</option>
              </select>
              <input
                value={form.nodeId}
                onChange={(e) => setForm({ ...form, nodeId: e.target.value })}
                placeholder="Record id (e.g. priya)"
                className={`${inputCls} w-full py-2`}
              />
              <input
                value={form.blobRef}
                onChange={(e) => setForm({ ...form, blobRef: e.target.value })}
                placeholder="Link or reference (URL, drive path…)"
                className={`${inputCls} w-full py-2`}
              />
              <input
                type="date"
                value={form.expiresOn}
                onChange={(e) => setForm({ ...form, expiresOn: e.target.value })}
                className={`${inputCls} w-full py-2`}
              />
              <label className="flex items-center gap-2 text-xs font-medium text-ink-soft">
                <input
                  type="checkbox"
                  checked={form.required}
                  onChange={(e) => setForm({ ...form, required: e.target.checked })}
                  className="accent-accent-strong"
                />
                Required document
              </label>
            </div>
            <AccentButton onClick={store} disabled={busy || !form.name || !form.nodeId}>
              {busy ? "Storing…" : "Store"}
            </AccentButton>
          </div>
        )}

        {documents.length === 0 ? (
          <Empty icon="projects" text="No documents filed yet — the register is empty." />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-ink-faint">
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">On record</th>
                  <th className="px-3 py-2 font-semibold">Version</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Access</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id} className="border-t border-line transition-colors hover:bg-raised">
                    <td className="px-3 py-2.5 text-[13px] font-semibold text-ink">{d.name}</td>
                    <td className="px-3 py-2.5 text-[13px] text-ink-soft">{d.nodeType}:{d.nodeId}</td>
                    <td className="px-3 py-2.5 text-[13px] text-ink-soft">v{d.version}</td>
                    <td className="px-3 py-2.5">
                      {d.required && d.version === 0 ? (
                        <span className="rounded-full bg-rose px-2.5 py-0.5 text-[11px] font-semibold text-rose-strong">Required · missing</span>
                      ) : d.required ? (
                        <span className="rounded-full bg-peach px-2.5 py-0.5 text-[11px] font-semibold text-peach-strong">Required · supplied</span>
                      ) : d.expiresOn ? (
                        <span className="rounded-full bg-raised px-2.5 py-0.5 text-[11px] font-semibold text-ink-faint">Expires {d.expiresOn}</span>
                      ) : (
                        <span className="text-[11px] text-ink-faint">supplied</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ink-faint">{d.roleAccess.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canStore && (
          <div className="mt-4 rounded-2xl border border-dashed border-line p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
              Mark a document as required
            </p>
            <div className="flex flex-wrap items-end gap-2.5">
              <input
                value={requireForm.name}
                onChange={(e) => setRequireForm({ ...requireForm, name: e.target.value })}
                placeholder="Document name"
                className={`${inputCls} py-2`}
              />
              <select
                value={requireForm.nodeType}
                onChange={(e) => setRequireForm({ ...requireForm, nodeType: e.target.value })}
                className={`${inputCls} py-2`}
              >
                <option value="employee">Employee</option>
                <option value="course">Course</option>
                <option value="event">Event</option>
              </select>
              <input
                value={requireForm.nodeId}
                onChange={(e) => setRequireForm({ ...requireForm, nodeId: e.target.value })}
                placeholder="Record id (e.g. priya)"
                className={`${inputCls} py-2`}
              />
              <AccentButton onClick={markRequired} disabled={busy || !requireForm.name || !requireForm.nodeId}>
                {busy ? "Marking…" : "Mark required"}
              </AccentButton>
            </div>
          </div>
        )}
      </section>

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
