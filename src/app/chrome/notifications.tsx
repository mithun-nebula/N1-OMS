"use client";

import { useEffect, useState } from "react";

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
        className="relative text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        title="Notifications"
      >
        <span className="text-base">🔔</span>
        {items.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-500 text-[8px] font-bold text-white">
            {items.length > 9 ? "9" : items.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 max-h-80 w-72 overflow-y-auto rounded-xl border border-black/[.1] bg-white shadow-lg dark:border-white/[.15] dark:bg-black">
          {items.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-zinc-400">No notifications.</p>
          ) : (
            items.map((n) => (
              <div key={n.id} className="border-b border-black/[.04] px-3 py-2 text-xs text-zinc-600 last:border-0 dark:border-white/[.06] dark:text-zinc-300">
                {n.message}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
