"use client";

import { useState } from "react";

export function ExportButton({ type, canExport }: { type: string; canExport: boolean }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!canExport) return null;
  async function exportCsv() {
    setNote(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/export?type=${type}`);
      if (res.status === 403) {
        setNote("Exporting is not available for your role.");
        return;
      }
      if (!res.ok) {
        setNote("Export failed — try again.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}-export.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setNote("Couldn't reach the server to export.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="relative inline-flex items-center gap-2">
      {note && (
        <span role="alert" className="fade-in rounded-full bg-danger-soft px-3 py-1 text-[11px] font-medium text-danger">
          {note}
        </span>
      )}
      <button
        onClick={exportCsv}
        disabled={busy}
        className="press rounded-full bg-surface px-3.5 py-1.5 text-xs font-semibold text-ink-soft shadow-card transition-colors hover:text-ink disabled:opacity-40"
      >
        {busy ? "Exporting…" : "⤓ Export CSV"}
      </button>
    </span>
  );
}
