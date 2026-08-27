"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

/*
 * Any figure can be opened into the parts it was computed from
 * (non-negotiable #13). Wrap the rendered number in <FigureValue> and it
 * becomes tappable: a small overlay fetches /api/figures/{type}/{id} and
 * shows the explainer plus every part. The route re-checks permission via
 * spine.read, so this can never show more than the record itself would.
 *
 * Rendered as a span, not a button, so it can sit inside clickable cards;
 * stopPropagation keeps the tap from also opening the card behind it.
 */

interface FigurePart {
  label: string;
  value: number | string | boolean;
  detail?: string;
}

interface FigureData {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  explainer: string;
  computedFrom: FigurePart[];
}

export function FigureValue({
  nodeType,
  nodeId,
  label,
  className = "",
  children,
}: {
  nodeType: string;
  nodeId: string;
  /** Optional: show only the figure with this label; otherwise all for the record. */
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [figures, setFigures] = useState<FigureData[]>([]);
  // The overlay is portalled to <body>. Several call sites sit inside cards
  // carrying the `.rise` animation, and a transformed ancestor becomes the
  // containing block for `position: fixed` — which pinned the panel beside the
  // card instead of centring it on the screen. `open` only ever becomes true
  // from a click, so the portal target exists whenever this renders.

  async function openBreakdown(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    e.preventDefault();
    setOpen(true);
    if (state === "ready" || state === "loading") return;
    setState("loading");
    try {
      const res = await fetch(`/api/figures/${encodeURIComponent(nodeType)}/${encodeURIComponent(nodeId)}`);
      if (!res.ok) throw new Error("failed");
      const body = (await res.json()) as { figures: FigureData[] };
      const all = body.figures ?? [];
      const shown = label ? all.filter((f) => f.label === label) : all;
      setFigures(shown.length > 0 ? shown : all);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  function close(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen(false);
  }

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        onClick={openBreakdown}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") openBreakdown(e);
        }}
        title="See how this number is made"
        className={`cursor-pointer underline decoration-accent-strong/60 decoration-dotted underline-offset-[3px] transition-colors hover:text-accent-strong ${className}`}
      >
        {children}
      </span>

      {open && createPortal(
        <span
          className="fade-in fixed inset-0 z-50 flex cursor-default items-end justify-center bg-chrome-deep/60 p-4 backdrop-blur-sm sm:items-center"
          onClick={close}
          role="dialog"
          aria-modal
          aria-label="How this number is made"
        >
          <span
            className="pop-in block max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-surface p-5 text-left shadow-lift"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="mb-3 flex items-center justify-between gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
                How this number is made
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={close}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") close(e as unknown as React.MouseEvent);
                }}
                className="press cursor-pointer text-xs font-medium text-ink-faint hover:text-ink"
              >
                Close
              </span>
            </span>

            {state === "loading" && (
              <span className="block space-y-2">
                <span className="block h-8 w-24 animate-pulse rounded-xl bg-raised" />
                <span className="block h-4 w-full animate-pulse rounded-xl bg-raised" />
                <span className="block h-4 w-2/3 animate-pulse rounded-xl bg-raised" />
              </span>
            )}

            {state === "error" && (
              <span className="block rounded-2xl bg-raised px-3 py-4 text-center text-xs text-ink-faint">
                This number has no recorded breakdown.
              </span>
            )}

            {state === "ready" && figures.length === 0 && (
              <span className="block rounded-2xl bg-raised px-3 py-4 text-center text-xs text-ink-faint">
                This number has no recorded breakdown.
              </span>
            )}

            {state === "ready" &&
              figures.map((f) => (
                <span key={f.id} className="mb-4 block last:mb-0">
                  <span className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-ink">
                      {f.value}
                      {f.unit ?? ""}
                    </span>
                    <span className="text-xs font-semibold text-ink-soft">{f.label}</span>
                  </span>
                  <span className="mt-1 block text-xs text-ink-faint">{f.explainer}</span>
                  <span className="mt-3 block space-y-1.5">
                    {f.computedFrom.map((p, i) => (
                      <span
                        key={i}
                        className="flex items-center justify-between gap-2 rounded-xl bg-raised px-3 py-2 text-xs"
                      >
                        <span className="min-w-0">
                          <span className="block font-medium text-ink">{p.label}</span>
                          {p.detail && <span className="block text-[11px] text-ink-faint">{p.detail}</span>}
                        </span>
                        <span className="shrink-0 font-bold text-ink-soft">{String(p.value)}</span>
                      </span>
                    ))}
                  </span>
                </span>
              ))}
          </span>
        </span>,
        document.body,
      )}
    </>
  );
}
