"use client";

import { useCallback, useEffect, useState } from "react";
import { Empty, PageTitle, SectionTitle } from "../ui/kit";
import { useLiveEvent } from "../chrome/live";
import { fmtDateShort } from "../ui/dates";

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/*
 * A personal look back: every planned day in the range, how it went, and the
 * honest split the product insists on — a day interrupted by meetings is not a
 * day that ran over (appendix A2–A4). Data comes from /api/today/history,
 * which only ever serves the signed-in person's own days.
 */

interface DaySummary {
  date: string;
  committed: number;
  done: number;
  committedMinutes: number;
  ranOver: number;
  interrupted: number;
  dropped: number;
  shortfallMinutes: number;
  onLeave: boolean;
  phase: string;
}

interface HistoryPayload {
  from: string;
  to: string;
  days: DaySummary[];
  totals: {
    daysPlanned: number;
    itemsCommitted: number;
    itemsDone: number;
    daysRanOver: number;
    daysInterrupted: number;
  };
  streak: { clean: number; bestClean: number; dayPlanned: boolean };
}

const RANGES = [
  { label: "30 days", days: 30 },
  { label: "60 days", days: 60 },
  { label: "90 days", days: 90 },
];

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** `Thu 27 Aug` — the weekday earns its place in a look-back over days. */
function niceDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const at = new Date(y, m - 1, d);
  // Composed rather than localised — see `ui/dates.ts`. A locale-dependent
  // string rendered on the server and again in the browser is a hydration
  // mismatch waiting for a machine set to a different language.
  const weekday = SHORT_DAYS[at.getDay()];
  return `${weekday} ${fmtDateShort(iso)}`;
}

/** One day's colour: how it went, at a glance. */
function dayTone(d: DaySummary): { cls: string; label: string } {
  if (d.onLeave) return { cls: "bg-line/50 text-ink-faint", label: "on leave" };
  if (d.committed === 0) return { cls: "bg-raised text-ink-faint", label: "not planned" };
  if (d.ranOver > 0) return { cls: "bg-peach text-peach-strong", label: "ran over" };
  if (d.interrupted > 0) return { cls: "bg-lilac text-lilac-strong", label: "interrupted" };
  if (d.done >= d.committed) return { cls: "bg-mint text-mint-strong", label: "clean" };
  return { cls: "bg-raised text-ink-soft", label: "part done" };
}

export function HistoryClient() {
  const [range, setRange] = useState(30);
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (days: number) => {
    try {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - (days - 1));
      const iso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const res = await fetch(`/api/today/history?from=${iso(from)}&to=${iso(to)}`);
      if (!res.ok) return;
      setData((await res.json()) as HistoryPayload);
    } catch {
      /* keep whatever is shown */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // State only changes after the fetch resolves, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(range);
  }, [load, range]);

  // Live: today's ticks and close-out land on the timeline as they happen.
  useLiveEvent(() => void load(range), { areas: ["day-plan"] });

  const planned = (data?.days ?? []).filter((d) => d.committed > 0 || d.onLeave);
  const recentFirst = [...planned].reverse();

  return (
    <>
      <PageTitle light="Your" bold="days">
        <div className="flex gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setRange(r.days)}
              className={`press rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                range === r.days
                  ? "bg-chrome text-chrome-ink"
                  : "bg-raised text-ink-soft hover:text-ink"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </PageTitle>

      <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
        <p className="rise text-xs text-ink-faint">
          Only you see this page — your streak and your days are never shown to your team
          or your manager.
        </p>

        {!loaded && (
          <div className="space-y-3">
            <div className="h-24 animate-pulse rounded-3xl bg-raised" />
            <div className="h-40 animate-pulse rounded-3xl bg-raised" />
          </div>
        )}

        {loaded && data && (
          <>
            {/* ============ Totals ============ */}
            <section
              className="rise grid grid-cols-2 gap-3 sm:grid-cols-5"
              style={{ animationDelay: "40ms" }}
            >
              <Stat label="Current streak" value={`${data.streak.clean}`} sub={`best ${data.streak.bestClean}`} highlight />
              <Stat label="Days planned" value={`${data.totals.daysPlanned}`} />
              <Stat
                label="Items done"
                value={`${data.totals.itemsDone}/${data.totals.itemsCommitted}`}
              />
              <Stat label="Days ran over" value={`${data.totals.daysRanOver}`} />
              <Stat label="Days interrupted" value={`${data.totals.daysInterrupted}`} />
            </section>

            {/* ============ The strip — every day in range ============ */}
            <section
              className="rise rounded-3xl bg-surface p-5 shadow-card"
              style={{ animationDelay: "90ms" }}
            >
              <SectionTitle>At a glance</SectionTitle>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(data.days ?? []).map((d) => {
                  const tone = dayTone(d);
                  return (
                    <span
                      key={d.date}
                      title={`${niceDate(d.date)} — ${tone.label}${
                        d.committed > 0 ? ` · ${d.done}/${d.committed} done` : ""
                      }`}
                      className={`grid h-7 w-7 place-items-center rounded-lg text-[9px] font-bold ${tone.cls}`}
                    >
                      {d.date.slice(-2)}
                    </span>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-ink-faint">
                <LegendDot cls="bg-mint" label="clean — everything done in its time" />
                <LegendDot cls="bg-lilac" label="interrupted — something else took the time" />
                <LegendDot cls="bg-peach" label="ran over" />
                <LegendDot cls="bg-line/50" label="leave" />
                <LegendDot cls="bg-raised" label="not planned" />
              </div>
            </section>

            {/* ============ Day by day ============ */}
            <section className="rise" style={{ animationDelay: "140ms" }}>
              <SectionTitle>Day by day</SectionTitle>
              {recentFirst.length === 0 ? (
                <Empty
                  icon="calendar"
                  text="No planned days in this range yet. Plan a morning on the dashboard and it will appear here."
                />
              ) : (
                <div className="mt-3 space-y-2">
                  {recentFirst.map((d, i) => {
                    const tone = dayTone(d);
                    return (
                      <div
                        key={d.date}
                        style={{ animationDelay: `${160 + Math.min(i, 10) * 35}ms` }}
                        className="rise flex flex-wrap items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-card"
                      >
                        <span className="w-28 text-[13px] font-semibold text-ink">
                          {niceDate(d.date)}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone.cls}`}
                        >
                          {tone.label}
                        </span>
                        {d.onLeave ? (
                          <span className="text-xs text-ink-faint">On leave — nothing expected.</span>
                        ) : (
                          <>
                            <span className="text-xs tabular-nums text-ink-soft">
                              {d.done} of {d.committed} done · {fmtMin(d.committedMinutes)} committed
                            </span>
                            <span className="ml-auto flex flex-wrap gap-1.5 text-[11px] text-ink-faint">
                              {d.interrupted > 0 && (
                                <span className="rounded-full bg-lilac px-2 py-0.5 font-semibold text-lilac-strong">
                                  {d.interrupted} interrupted
                                </span>
                              )}
                              {d.ranOver > 0 && (
                                <span className="rounded-full bg-peach px-2 py-0.5 font-semibold text-peach-strong">
                                  {d.ranOver} ran over
                                </span>
                              )}
                              {d.dropped > 0 && <span>{d.dropped} dropped</span>}
                              {d.shortfallMinutes > 0 && (
                                <span>{fmtMin(d.shortfallMinutes)} short</span>
                              )}
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-3.5 shadow-card ${
        highlight ? "bg-chrome text-chrome-ink" : "bg-surface"
      }`}
    >
      <div
        className={`text-[10px] font-semibold uppercase tracking-widest ${
          highlight ? "text-chrome-soft" : "text-ink-faint"
        }`}
      >
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`text-xl font-extrabold tabular-nums ${highlight ? "text-accent" : "text-ink"}`}>
          {value}
        </span>
        {sub && (
          <span className={`text-[11px] ${highlight ? "text-chrome-soft" : "text-ink-faint"}`}>
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

function LegendDot({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded ${cls}`} />
      {label}
    </span>
  );
}
