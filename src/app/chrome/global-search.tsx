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
        className="w-full rounded-lg border border-black/[.1] bg-black/[.03] px-3 py-1.5 text-xs text-black placeholder:text-zinc-400 focus:border-teal-700 focus:outline-none dark:border-white/[.15] dark:bg-white/[.04] dark:text-zinc-50"
      />
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-black/[.1] bg-white shadow-lg dark:border-white/[.15] dark:bg-black">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => go(r)}
              className="block w-full px-3 py-2 text-left text-xs hover:bg-teal-700/5 dark:hover:bg-white/[.05]"
            >
              <span className="font-medium text-black dark:text-zinc-50">{r.label}</span>
              <span className="ml-2 text-zinc-400">{r.nodeType}{r.sub ? ` · ${r.sub}` : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
