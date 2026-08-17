"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Result {
  nodeType: string;
  nodeId: string;
  label: string;
  sub?: string;
}

const ROUTES: Record<string, string> = {
  employee: "/team",
  course: "/courses",
  task: "/tasks",
  meeting: "/meetings",
  event: "/events",
  announcement: "/announcements",
  "org-memory": "/decisions",
};

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
      if (res.ok) setResults((await res.json()).results ?? []);
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(r: Result) {
    setOpen(false);
    setQ("");
    setResults([]);
    router.push(ROUTES[r.nodeType] ?? "/dashboard");
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search people, courses, tasks…"
        className="w-full rounded-xl border border-chrome-line bg-white/[.06] px-3 py-2 text-xs text-chrome-ink transition-colors placeholder:text-chrome-soft focus:border-accent focus:bg-white/[.09] focus:outline-none"
      />
      {open && results.length > 0 && (
        <div className="pop-in absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl bg-surface shadow-lift">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => go(r)}
              className="block w-full px-3 py-2 text-left text-xs transition-colors hover:bg-accent-soft"
            >
              <span className="font-medium text-ink">{r.label}</span>
              <span className="ml-2 text-ink-faint">{r.nodeType}{r.sub ? ` · ${r.sub}` : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
