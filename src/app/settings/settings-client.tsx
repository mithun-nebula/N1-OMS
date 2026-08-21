"use client";

import { useState } from "react";
import { Icon } from "../ui/icons";
import { AccentButton, inputCls, OpFeedback, SectionTitle } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";

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
  const op = useOperation();
  const [contactValue, setContactValue] = useState(contact ?? "");
  const [msg, setMsg] = useState<string | null>(null);

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
    setMsg(null);
    const outcome = await op.run("employee.updateContact", {
      employeeId,
      contact: contactValue.trim(),
    });
    if (outcome.status === "ran") setMsg("Contact updated.");
  }

  async function savePassword() {
    setPwMsg(null);
    if (pw.next !== pw.confirm) {
      setPwMsg({ ok: false, text: "New passwords do not match." });
      return;
    }
    setPwBusy(true);
    try {
      const res = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current: pw.current, next: pw.next }),
      });
      // A non-JSON 500 must land as a message, not an unhandled throw that
      // leaves the spinner stopping with no explanation.
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setPwMsg({ ok: true, text: "Password changed." });
        setPw({ current: "", next: "", confirm: "" });
      } else {
        setPwMsg({ ok: false, text: data.error ?? "Could not change password." });
      }
    } catch {
      setPwMsg({ ok: false, text: "Couldn't reach the server — try again." });
    } finally {
      setPwBusy(false);
    }
  }

  const labelCls = "text-[10px] font-semibold uppercase tracking-widest text-ink-faint";

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      {/* Profile. */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "60ms" }}>
        <SectionTitle>Profile</SectionTitle>
        <div className="mt-4 space-y-3">
          <div className="rounded-xl bg-raised px-3.5 py-2.5">
            <div className={labelCls}>Display name</div>
            <div className="mt-1 text-[13px] text-ink">
              {displayName} <span className="text-ink-faint">(@{username})</span>
            </div>
            <p className="mt-1 text-[11px] text-ink-faint">Display name changes require an admin.</p>
          </div>
          <div className="rounded-xl bg-raised px-3.5 py-2.5">
            <div className={labelCls}>Contact</div>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                value={contactValue}
                onChange={(e) => setContactValue(e.target.value)}
                className={`${inputCls} flex-1`}
              />
              <button
                onClick={saveContact}
                disabled={op.busy || !contactValue.trim()}
                className="press rounded-lg bg-chrome px-3 py-1.5 text-[11px] font-semibold text-chrome-ink transition-colors hover:bg-chrome-card disabled:opacity-40"
              >
                Save
              </button>
            </div>
            {msg && (
              <p className="fade-in mt-2 rounded-xl bg-mint px-3 py-2 text-xs font-medium text-mint-strong">{msg}</p>
            )}
          </div>
        </div>
      </section>

      {/* Change password. */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "130ms" }}>
        <SectionTitle>Change password</SectionTitle>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:max-w-md">
          <input
            type="password"
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
            placeholder="Current password"
            className={`${inputCls} w-full py-2`}
          />
          <input
            type="password"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
            placeholder="New password"
            className={`${inputCls} w-full py-2`}
          />
          <input
            type="password"
            value={pw.confirm}
            onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            placeholder="Confirm new password"
            className={`${inputCls} w-full py-2`}
          />
          {pwMsg && (
            <p
              className={`fade-in rounded-xl px-3 py-2 text-xs font-medium ${
                pwMsg.ok ? "bg-mint text-mint-strong" : "bg-danger-soft text-danger"
              }`}
            >
              {pwMsg.text}
            </p>
          )}
          <div>
            <AccentButton onClick={savePassword} disabled={pwBusy || !pw.current || !pw.next || !pw.confirm}>
              {pwBusy ? "Saving…" : "Update password"}
            </AccentButton>
          </div>
        </div>
      </section>

      {/* Preferences. */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "200ms" }}>
        <SectionTitle>Preferences</SectionTitle>
        <div className="mt-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-raised px-3.5 py-2.5">
            <span className="text-[13px] text-ink">Theme</span>
            <div className="flex gap-1.5">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => applyTheme(t)}
                  className={`press flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold capitalize transition-colors ${
                    theme === t ? "bg-chrome text-chrome-ink" : "bg-surface text-ink-soft shadow-card hover:text-ink"
                  }`}
                >
                  <Icon name={t === "light" ? "sun" : "moon"} className="h-3.5 w-3.5" />
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-raised px-3.5 py-2.5">
            <span className="text-[13px] text-ink">
              Notifications <span className="text-[11px] text-ink-faint">(local preference)</span>
            </span>
            <NotificationPrefToggle />
          </div>
        </div>
      </section>

      <OpFeedback
        error={op.error}
        confirmation={op.confirmation}
        busy={op.busy}
        onConfirm={() => op.confirm()}
        onCancel={op.cancel}
        onDismiss={op.reset}
      />
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
      className={`press relative h-5 w-9 rounded-full transition-colors ${on ? "bg-accent-strong" : "bg-line"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-card transition-all ${on ? "left-4" : "left-0.5"}`}
      />
    </button>
  );
}
