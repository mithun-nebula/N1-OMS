"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SettingsClient({
  employeeId,
  displayName,
  username,
  contact,
}: {
  employeeId: string;
  displayName: string;
  username: string;
  contact?: string;
}) {
  const router = useRouter();
  const [contactValue, setContactValue] = useState(contact ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  const [theme, setTheme] = useState<"light" | "dark">(
    typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light",
  );

  function applyTheme(next: "light" | "dark") {
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

  async function saveContact() {
    setBusy(true);
    const res = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: "form", name: "employee.updateContact", args: { employeeId, contact: contactValue.trim() } }),
    });
    setBusy(false);
    const data = await res.json();
    if (data.status === "ran") {
      setMsg("Contact updated.");
      router.refresh();
    } else {
      setMsg(data.detail ?? data.opaqueMessage ?? "Could not update.");
    }
  }

  async function savePassword() {
    setPwMsg(null);
    if (pw.next !== pw.confirm) {
      setPwMsg("New passwords do not match.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/settings/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current: pw.current, next: pw.next }),
    });
    setBusy(false);
    const data = await res.json();
    if (data.ok) {
      setPwMsg("Password changed.");
      setPw({ current: "", next: "", confirm: "" });
    } else {
      setPwMsg(data.error ?? "Could not change password.");
    }
  }

  return (
    <div className="space-y-6 p-6">
      <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Profile</h2>
        <div className="space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-400">Display name</div>
            <div className="mt-1 text-sm text-black dark:text-zinc-50">{displayName} <span className="text-zinc-400">(@{username})</span></div>
            <p className="mt-1 text-xs text-zinc-400">Display name changes require an admin.</p>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-400">Contact</div>
            <div className="mt-1 flex items-center gap-2">
              <input value={contactValue} onChange={(e) => setContactValue(e.target.value)} className="flex-1 rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
              <button onClick={saveContact} disabled={busy || !contactValue.trim()} className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">Save</button>
            </div>
            {msg && <p className="mt-1 text-xs text-teal-600">{msg}</p>}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Change password</h2>
        <div className="grid grid-cols-1 gap-3 sm:max-w-md">
          <input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} placeholder="Current password" className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          <input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="New password" className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          <input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} placeholder="Confirm new password" className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          <button onClick={savePassword} disabled={busy || !pw.current || !pw.next || !pw.confirm} className="self-start rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black">Update password</button>
          {pwMsg && <p className="text-xs text-teal-600">{pwMsg}</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Preferences</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">Theme</span>
            <div className="flex gap-2">
              {(["light", "dark"] as const).map((t) => (
                <button key={t} onClick={() => applyTheme(t)} className={`rounded-lg border px-3 py-1 text-xs ${theme === t ? "border-teal-700 bg-teal-700/10 text-teal-700" : "border-black/[.1] text-zinc-500 dark:border-white/[.2]"}`}>
                  {t === "light" ? "☀ Light" : "☾ Dark"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">Notifications <span className="text-xs text-zinc-400">(local preference)</span></span>
            <NotificationPrefToggle />
          </div>
        </div>
      </section>
    </div>
  );
}

function NotificationPrefToggle() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem("notif") !== "off";
    } catch {
      return true;
    }
  });
  return (
    <button
      onClick={() => {
        const next = !on;
        setOn(next);
        try {
          localStorage.setItem("notif", next ? "on" : "off");
        } catch {
          /* ignore */
        }
      }}
      className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-teal-700" : "bg-zinc-300 dark:bg-zinc-700"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-4" : "left-0.5"}`} />
    </button>
  );
}
