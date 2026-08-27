"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui/icons";
import { fmtDateTime } from "../ui/dates";
import { useLiveEvent } from "./live";

/**
 * Where the panel goes, measured from the bell rather than assumed.
 *
 * ⚠ The bell is mounted in two places with opposite geometry: the **bottom** of
 * the desktop sidebar and the **top** of the mobile bar. Fixed Tailwind
 * positions had it opening off-screen on both — downward from the bottom rail,
 * upward from the top bar — which is why the panel appeared to be missing.
 * Measuring decides it correctly for either, and for anywhere it is mounted
 * next.
 */
function placeFrom(button: HTMLElement | null) {
  if (!button || typeof window === "undefined") return null;
  const r = button.getBoundingClientRect();
  const gap = 8;
  const pad = 12;
  const width = Math.min(288, window.innerWidth - pad * 2);
  // Away from the nearer edge: a bell low on the screen opens upward.
  const openDown = r.top < window.innerHeight / 2;
  const left = Math.min(Math.max(pad, r.left), window.innerWidth - width - pad);
  return {
    width,
    left,
    ...(openDown
      ? { top: r.bottom + gap }
      : { bottom: window.innerHeight - r.top + gap }),
  } as { width: number; left: number; top?: number; bottom?: number };
}

interface Notification {
  id: string;
  at: string;
  message: string;
  kind: string;
  read: boolean;
}

export function NotificationsBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<ReturnType<typeof placeFrom>>(null);

  /** Returns what it loaded, so callers act on fresh data — not a stale closure. */
  const load = useCallback(async (): Promise<Notification[]> => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return [];
      const data = await res.json();
      const fresh: Notification[] = data.notifications ?? [];
      setItems(fresh);
      setUnread(data.unread ?? 0);
      return fresh;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    // State only changes after the fetch resolves, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // The push stream is the real signal now; this is a rare safety-net poll
    // (it replaced a 30-second interval).
    const t = setInterval(() => void load(), 300_000);
    return () => clearInterval(t);
  }, [load]);

  // Live: the server says the bell moved — no more waiting out a poll cycle.
  useLiveEvent(() => void load(), { areas: ["notifications"] });

  // A moved bell means a stale position; the next open measures again.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [open]);

  /** Opening the panel is reading them — the count only counts what is new. */
  async function openPanel() {
    setPlace(placeFrom(btnRef.current));
    setOpen(true);
    // Act on what load() RETURNED. It used to read the `items` state variable
    // right after awaiting load(), which is the pre-load closure value — so the
    // first open could mark the wrong set read.
    const fresh = await load();
    const unseen = fresh.filter((n) => !n.read).map((n) => n.id);
    if (unseen.length === 0) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: unseen }),
    }).catch(() => {});
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className="press relative grid h-8 w-8 place-items-center rounded-full text-chrome-soft transition-colors hover:bg-white/[.06] hover:text-chrome-ink"
        title="Notifications"
      >
        <Icon name="bell" className="h-4.5 w-4.5" />
        {unread > 0 && (
          <span className="pulse-dot absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[8px] font-bold text-chrome">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {/*
        ⚠ Portalled to <body>, and positioned from the measured bell.
        Two bugs put this panel out of sight, and both are worth naming because
        the next floating thing will meet them too:

        1 · It opened toward the edge the bell sits on — downward from the
            bottom of the desktop rail, upward from the mobile top bar — so it
            rendered off-screen on both. `placeFrom` decides by measuring.
        2 · Rendered in place it sat inside the **sticky sidebar's stacking
            context**, so `z-50` only ranked it against its siblings there and
            the dashboard cards painted straight over it. A portal is the only
            reliable way out of an ancestor's stacking context — the same fix
            `ui/figure.tsx` needed.
      */}
      {open && place && typeof document !== "undefined" && createPortal(
        <>
          <button
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[60] cursor-default"
          />
          <div
            role="dialog"
            aria-label="Notifications"
            style={{
              width: place.width,
              left: place.left,
              ...(place.top !== undefined ? { top: place.top } : {}),
              ...(place.bottom !== undefined ? { bottom: place.bottom } : {}),
            }}
            className="pop-in fixed z-[61] max-h-80 overflow-y-auto rounded-2xl border border-line bg-surface shadow-lift"
          >
            <div className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
              Notifications
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-5 text-center text-xs text-ink-faint">
                Nothing needs you right now.
              </p>
            ) : (
              items.map((n) => (
                <div key={n.id} className="border-b border-line px-4 py-2.5 last:border-0">
                  <div className="text-xs text-ink-soft">{n.message}</div>
                  <div className="mt-0.5 text-[10px] text-ink-faint" suppressHydrationWarning>
                    {fmtDateTime(n.at)}
                  </div>
                </div>
              ))
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
