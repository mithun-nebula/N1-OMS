"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../ui/icons";

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

  const load = useCallback(async () => {
    const res = await fetch("/api/notifications");
    if (!res.ok) return;
    const data = await res.json();
    setItems(data.notifications ?? []);
    setUnread(data.unread ?? 0);
  }, []);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      const res = await fetch("/api/notifications");
      if (!active || !res.ok) return;
      const data = await res.json();
      setItems(data.notifications ?? []);
      setUnread(data.unread ?? 0);
    };
    tick();
    const t = setInterval(tick, 30000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  /** Opening the panel is reading them — the count only counts what is new. */
  async function openPanel() {
    setOpen(true);
    await load();
    const unseen = items.filter((n) => !n.read).map((n) => n.id);
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
      {open && (
        <div className="pop-in absolute bottom-full right-0 z-50 mb-2 max-h-80 w-72 overflow-y-auto rounded-2xl bg-surface shadow-lift md:bottom-auto md:top-full md:mb-0 md:mt-2">
          <div className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
            Notifications
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-5 text-center text-xs text-ink-faint">
              Nothing needs you right now.
            </p>
          ) : (
            items.map((n) => (
              <div key={n.id} className="border-b border-line px-4 py-2.5 text-xs text-ink-soft last:border-0">
                {n.message}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
