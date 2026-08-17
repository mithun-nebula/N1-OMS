"use client";

export function ExportButton({ type, canExport }: { type: string; canExport: boolean }) {
  if (!canExport) return null;
  async function exportCsv() {
    const res = await fetch(`/api/export?type=${type}`);
    if (res.status === 403) {
      alert("Exporting is not available for your role.");
      return;
    }
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}-export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button
      onClick={exportCsv}
      className="press rounded-full bg-surface px-3.5 py-1.5 text-xs font-semibold text-ink-soft shadow-card transition-colors hover:text-ink"
    >
      ⤓ Export CSV
    </button>
  );
}
