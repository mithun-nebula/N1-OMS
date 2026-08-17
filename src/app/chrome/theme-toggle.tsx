"use client";

import { useEffect, useState } from "react";
import { Icon } from "../ui/icons";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    // Syncing from the no-flash theme class set on <html> by the layout script.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(isDark ? "dark" : "light");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    const el = document.documentElement;
    el.classList.remove("light", "dark");
    el.classList.add(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      className="press flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-chrome-soft transition-colors hover:bg-white/[.06] hover:text-chrome-ink"
    >
      <span className="relative grid h-4 w-4 place-items-center overflow-hidden">
        <span
          className={`absolute transition-all duration-300 ${
            theme === "dark" ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
          }`}
        >
          <Icon name="sun" className="h-3.5 w-3.5" />
        </span>
        <span
          className={`absolute transition-all duration-300 ${
            theme === "dark" ? "-translate-y-4 opacity-0" : "translate-y-0 opacity-100"
          }`}
        >
          <Icon name="moon" className="h-3.5 w-3.5" />
        </span>
      </span>
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
