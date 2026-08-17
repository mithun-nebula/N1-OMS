"use client";

import { useState } from "react";
import { Icon } from "../ui/icons";
import { AccentButton, ChromeButton, Empty, inputCls, OpFeedback, SectionTitle } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";

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
  const op = useOperation();
  const busy = op.busy;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ roomId: "", title: "", from: "", to: "" });
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function book() {
    if (!form.roomId || !form.title || !form.from || !form.to) return;
    setResult(null);
    const outcome = await op.run("room.book", {
      roomId: form.roomId,
      title: form.title,
      from: new Date(form.from).toISOString(),
      to: new Date(form.to).toISOString(),
    });
    if (outcome.status === "ran") {
      const resolved = (outcome.response as { resolved?: boolean } | undefined)?.resolved;
      setResult(
        resolved
          ? { ok: true, text: "Booked!" }
          : { ok: false, text: "Could not book — clash detected." },
      );
      setShowForm(false);
      setForm({ roomId: "", title: "", from: "", to: "" });
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      {/* Rooms at a glance. */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "60ms" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle>Rooms</SectionTitle>
          <ChromeButton onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "+ Book a room"}
          </ChromeButton>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((r, i) => (
            <div
              key={r.id}
              className="rise rounded-2xl bg-raised p-3.5"
              style={{ animationDelay: `${110 + i * 50}ms` }}
            >
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-strong">
                  <Icon name="booking" className="h-3.5 w-3.5" />
                </span>
                <span className="text-[13px] font-semibold text-ink">{r.name}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-lilac px-2 py-0.5 text-[10px] font-bold text-lilac-strong">
                  seats {r.capacity}
                </span>
                {r.equipment.map((eq) => (
                  <span key={eq} className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium text-ink-soft">
                    {eq}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {showForm && (
          <div className="pop-in mt-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <select
                value={form.roomId}
                onChange={(e) => setForm({ ...form, roomId: e.target.value })}
                className={`${inputCls} w-full py-2`}
              >
                <option value="">Select a room</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} (cap {r.capacity})</option>
                ))}
              </select>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="What's this for?"
                className={`${inputCls} w-full py-2`}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <input type="datetime-local" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className={inputCls} />
              <input type="datetime-local" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className={inputCls} />
            </div>
            <AccentButton onClick={book} disabled={busy || !form.roomId || !form.title}>
              {busy ? "Booking…" : "Book"}
            </AccentButton>
          </div>
        )}
      </section>

      {result && (
        <p
          className={`fade-in rounded-xl px-3 py-2 text-xs font-semibold ${
            result.ok ? "bg-mint text-mint-strong" : "bg-danger-soft text-danger"
          }`}
        >
          {result.text}
        </p>
      )}

      {/* Current bookings. */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "160ms" }}>
        <SectionTitle>Current bookings</SectionTitle>
        {bookings.length === 0 ? (
          <Empty icon="booking" text="No rooms booked — the day is open." />
        ) : (
          <div className="mt-3 space-y-2">
            {bookings.map((b, i) => (
              <div
                key={b.id}
                className="rise flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-raised px-3.5 py-2.5"
                style={{ animationDelay: `${210 + i * 50}ms` }}
              >
                <div className="min-w-0 text-[13px]">
                  <span className="font-semibold text-ink">{b.title}</span>
                  <span className="ml-2 rounded-full bg-mint px-2 py-0.5 text-[10px] font-bold text-mint-strong">
                    {b.roomName}
                  </span>
                </div>
                <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-soft">
                  <Icon name="clock" className="h-3 w-3" />
                  {b.from && new Date(b.from).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                  {b.to && ` → ${new Date(b.to).toLocaleTimeString([], { timeStyle: "short" })}`}
                </span>
              </div>
            ))}
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
