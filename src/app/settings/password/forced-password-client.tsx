"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputCls } from "../../ui/kit";

const MIN_LENGTH = 6;

export function ForcedPasswordChange({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field = `${inputCls} w-full py-2`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    if (next.length < MIN_LENGTH) {
      setError(`New password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (next === current) {
      setError("Choose a password different from the temporary one.");
      return;
    }
    setBusy(true);
    // This is the one screen a locked-out account MUST get through — a
    // non-JSON error body or a network drop still has to produce a message.
    let data: { ok?: boolean; error?: string };
    try {
      const res = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    } catch {
      data = { ok: false, error: "Couldn't reach the server — try again." };
    }
    setBusy(false);
    if (!data.ok) {
      setError(data.error ?? "Could not change password.");
      return;
    }
    // The route re-issues the session cookie with the flag cleared, so a full
    // navigation is needed for middleware to see it.
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-3">
      <input
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        placeholder={forced ? "Temporary password" : "Current password"}
        autoComplete="current-password"
        className={field}
      />
      <input
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder="New password"
        autoComplete="new-password"
        className={field}
      />
      <input
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Confirm new password"
        autoComplete="new-password"
        className={field}
      />
      {error && (
        <p className="fade-in rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">{error}</p>
      )}
      <button
        type="submit"
        disabled={busy || !current || !next || !confirm}
        className="press w-full rounded-xl bg-accent-strong px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent disabled:opacity-40"
      >
        {busy ? "Saving…" : "Set password"}
      </button>
    </form>
  );
}
