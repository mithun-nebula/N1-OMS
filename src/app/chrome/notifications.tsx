"use client";

import { useEffect, useState } from "react";
import { Icon } from "../ui/icons";

interface Notification {
  id: number;
  message: string;
  kind: string;
}

export function NotificationsBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  async function refresh() {
    const res = await fetch("/api/notifications");
    if (res.ok) {
      const data = await res.json();
      setItems(data.notifications ?? []);
    }
  }

  useEffect(() => {
    let active = true;
    async function load() {
      const res = await fetch("/api/notifications");
      if (active && res.ok) {
        const data = await res.json();
        setItems(data.notifications ?? []);
      }
    }
    load();
    const t = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen(!open); if (!open) refresh(); }}
        className="press relative grid h-8 w-8 place-items-center rounded-full text-chrome-soft transition-colors hover:bg-white/[.06] hover:text-chrome-ink"
        title="Notifications"
      >
        <Icon name="bell" className="h-4.5 w-4.5" />
        {items.length > 0 && (
          <span className="pulse-dot absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[8px] font-bold text-chrome">
            {items.length > 9 ? "9" : items.length}
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
