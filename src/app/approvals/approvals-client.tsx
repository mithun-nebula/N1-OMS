"use client";

import { useCallback, useEffect, useState } from "react";
import { Empty, PageTitle, SectionTitle } from "../ui/kit";
import { useLiveEvent } from "../chrome/live";

/*
 * Lists what is prepared and waiting for the signed-in person, and lets them
 * approve or discard it. Approve submits the prepared operation under their
 * own hand through POST /api/proposals/{id} — the same gate, permission
 * policy and activity log as every other write. Nothing here widens what the
 * person may do; the server re-checks everything on the tap.
 */

interface Proposal {
  proposalId: string;
  summary: string;
  operation: string;
  expiresAt: number;
  /** Snapshot taken when the list was fetched, so render stays pure. */
  minutesLeft: number;
}

type CardState =
  | { kind: "open" }
  | { kind: "busy" }
  | { kind: "error"; reason: string };

export function ApprovalsClient() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cardState, setCardState] = useState<Record<string, CardState>>({});
  const [lastDone, setLastDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/proposals");
      if (!res.ok) return;
      const body = (await res.json()) as {
        proposals?: Array<Omit<Proposal, "minutesLeft">>;
      };
      const now = Date.now();
      setProposals(
        (Array.isArray(body.proposals) ? body.proposals : []).map((p) => ({
          ...p,
          minutesLeft: Math.max(0, Math.round((p.expiresAt - now) / 60000)),
        })),
      );
    } catch {
      /* leave the list as it is */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // All state updates happen after the fetch resolves, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // A proposal can arrive while this tab is in the background — refresh when
    // the person comes back to it, the same moment they would start reading.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // Live: a proposal prepared in chat or by voice appears here as it is made.
  useLiveEvent(() => void load(), { areas: ["proposals"] });

  function setState(id: string, s: CardState) {
    setCardState((m) => ({ ...m, [id]: s }));
  }

  async function approve(p: Proposal) {
    setState(p.proposalId, { kind: "busy" });
    try {
      const res = await fetch(`/api/proposals/${encodeURIComponent(p.proposalId)}`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        summary?: string;
        error?: string;
      };
      if (!res.ok) {
        setState(p.proposalId, {
          kind: "error",
          reason: body.error ?? "That could not be completed.",
        });
        return;
      }
      setProposals((list) => list.filter((x) => x.proposalId !== p.proposalId));
      setLastDone(body.summary ?? p.summary);
    } catch {
      setState(p.proposalId, { kind: "error", reason: "Network problem — try again." });
    }
  }

  async function discard(p: Proposal) {
    setState(p.proposalId, { kind: "busy" });
    try {
      const res = await fetch(`/api/proposals/${encodeURIComponent(p.proposalId)}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404) {
        setState(p.proposalId, { kind: "error", reason: "That could not be discarded." });
        return;
      }
      // 404 means it is already gone (expired, or taken elsewhere) — same result.
      setProposals((list) => list.filter((x) => x.proposalId !== p.proposalId));
    } catch {
      setState(p.proposalId, { kind: "error", reason: "Network problem — try again." });
    }
  }

  return (
    <>
      <PageTitle light="Waiting for" bold="your hand">
        <button
          onClick={() => load()}
          className="press rounded-full bg-chrome px-4 py-2 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card"
        >
          Refresh
        </button>
      </PageTitle>

      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <p className="rise text-xs text-ink-faint">
          The assistant prepares these — by voice or chat — but anything touching money or
          people is only ever completed by your own tap. Approving here is recorded in the
          activity log under your name.
        </p>

        {lastDone && (
          <div className="pop-in flex items-center gap-3 rounded-2xl border-l-[3px] border-mint-strong bg-mint px-4 py-3">
            <span className="text-sm font-semibold text-mint-strong">Done</span>
            <span className="min-w-0 flex-1 text-xs text-ink">{lastDone}</span>
            <button
              onClick={() => setLastDone(null)}
              className="press shrink-0 text-xs font-medium text-ink-faint hover:text-ink"
            >
              OK
            </button>
          </div>
        )}

        <section className="rise" style={{ animationDelay: "60ms" }}>
          <SectionTitle>Prepared ({proposals.length})</SectionTitle>

          {!loaded && (
            <div className="mt-3 space-y-2">
              <div className="h-20 animate-pulse rounded-3xl bg-raised" />
              <div className="h-20 animate-pulse rounded-3xl bg-raised" />
            </div>
          )}

          {loaded && proposals.length === 0 && (
            <Empty icon="check" text="Nothing is waiting for you. Ask the assistant to prepare something — it will appear here." />
          )}

          <div className="mt-3 space-y-3">
            {proposals.map((p, i) => {
              const s = cardState[p.proposalId] ?? { kind: "open" };
              return (
                <div
                  key={p.proposalId}
                  style={{ animationDelay: `${80 + i * 50}ms` }}
                  className="rise rounded-3xl border-l-[3px] border-accent-strong bg-surface p-4 shadow-card"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-strong">
                      {p.operation}
                    </span>
                    <span className="text-[11px] text-ink-faint">
                      {p.minutesLeft > 0 ? `expires in ${p.minutesLeft}m` : "expiring"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-ink">{p.summary}</p>

                  {s.kind === "error" && (
                    <p className="mt-2 rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
                      {s.reason}
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-2.5">
                    <button
                      onClick={() => approve(p)}
                      disabled={s.kind === "busy"}
                      className="press rounded-xl bg-accent-strong px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent disabled:opacity-40"
                    >
                      {s.kind === "busy" ? "Working…" : "Approve"}
                    </button>
                    <button
                      onClick={() => discard(p)}
                      disabled={s.kind === "busy"}
                      className="press rounded-xl bg-raised px-4 py-2 text-xs font-semibold text-ink-soft transition-colors hover:text-ink disabled:opacity-40"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
