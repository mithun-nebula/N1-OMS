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
      className="rounded-lg border border-black/[.1] px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-black/[.04] dark:border-white/[.2] dark:text-zinc-300"
    >
      ⤓ Export CSV
    </button>
  );
}
