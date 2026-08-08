"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Room {
  id: string;
  name: string;
  capacity: number;
  equipment: string[];
}

interface Booking {
  id: string;
  roomId: string;
  roomName: string;
  title: string;
  from: string;
  to: string;
}

export function BookingClient({
  rooms,
  bookings,
}: {
  rooms: Room[];
  bookings: Booking[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ roomId: "", title: "", from: "", to: "" });
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function book() {
    if (!form.roomId || !form.title || !form.from || !form.to) return;
    setBusy(true);
    const res = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: "form",
        name: "room.book",
        args: {
          roomId: form.roomId,
          title: form.title,
          from: new Date(form.from).toISOString(),
          to: new Date(form.to).toISOString(),
        },
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.status === "ran") {
      setResult(data.result?.response?.resolved ? "Booked!" : "Could not book — clash detected.");
      setShowForm(false);
      setForm({ roomId: "", title: "", from: "", to: "" });
      router.refresh();
    } else {
      setResult("Booking failed.");
    }
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex flex-wrap gap-3">
          {rooms.map((r) => (
            <div key={r.id} className="rounded-xl border border-black/[.08] p-3 dark:border-white/[.12]">
              <div className="text-sm font-medium text-black dark:text-zinc-50">{r.name}</div>
              <div className="text-xs text-zinc-400">Capacity {r.capacity} · {r.equipment.join(", ")}</div>
            </div>
          ))}
        </div>
        <button onClick={() => setShowForm(!showForm)} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white">
          {showForm ? "Cancel" : "+ Book a room"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 space-y-3 rounded-xl border border-dashed border-black/[.12] p-4 dark:border-white/[.15]">
          <select value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })} className="w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50">
            <option value="">Select a room</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name} (cap {r.capacity})</option>)}
          </select>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What's this for?" className="w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          <div className="flex gap-3">
            <input type="datetime-local" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
            <input type="datetime-local" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          </div>
          <button onClick={book} disabled={busy || !form.roomId || !form.title} className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black">Book</button>
        </div>
      )}

      {result && <p className="mb-4 text-sm text-teal-600">{result}</p>}

      <div className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Current bookings</h2>
        {bookings.length === 0 ? (
          <p className="text-sm text-zinc-400">No bookings.</p>
        ) : (
          bookings.map((b) => (
            <div key={b.id} className="flex items-center justify-between rounded-lg border border-black/[.08] bg-white px-4 py-2 text-sm dark:border-white/[.12] dark:bg-black">
              <div>
                <span className="font-medium text-black dark:text-zinc-50">{b.title}</span>
                <span className="ml-3 text-zinc-400">{b.roomName}</span>
              </div>
              <span className="text-xs text-zinc-400">
                {b.from && new Date(b.from).toLocaleString()} → {b.to && new Date(b.to).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
