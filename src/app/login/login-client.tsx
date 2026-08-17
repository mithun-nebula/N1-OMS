"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../ui/icons";

export interface DemoLogin {
  username: string;
  password: string;
  role: string;
  name: string;
}

export function LoginForm({ demoLogins }: { demoLogins: DemoLogin[] }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  async function login(u: string, p: string, failMessage: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
      return;
    }
    setError(failMessage);
    setShake((s) => s + 1); // retrigger the shake animation
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await login(username, password, "Invalid username or password.");
  }

  async function quick(u: string, p: string) {
    setUsername(u);
    setPassword(p);
    await login(u, p, "Login failed.");
  }

  return (
    <div className="flex min-h-screen bg-base">
      {/* ============ Brand panel (desktop) ============ */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-chrome p-10 text-chrome-ink lg:flex">
        <div className="rise flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-accent text-chrome">
            <Icon name="spark" className="h-5 w-5" />
          </span>
          <div>
            <div className="text-base font-bold tracking-tight">Organization A</div>
            <div className="text-[10px] uppercase tracking-widest text-chrome-soft">
              Operations
            </div>
          </div>
        </div>

        <div className="rise relative z-10" style={{ animationDelay: "120ms" }}>
          <h1 className="max-w-md text-4xl font-light leading-tight tracking-tight">
            Every action, <span className="font-extrabold text-accent">recorded</span>.
            <br />
            Every day, <span className="font-extrabold">at a glance</span>.
          </h1>
          <p className="mt-4 max-w-sm text-sm text-chrome-soft">
            One place for your tasks, meetings, courses and people — with a
            single gate everything runs through.
          </p>
        </div>

        <div className="rise text-[11px] text-chrome-soft" style={{ animationDelay: "220ms" }}>
          Assistant-first, operation-based work application
        </div>

        {/* Decorative arcs echoing the dashboard's day arc. */}
        <div
          aria-hidden
          className="absolute -bottom-40 -right-40 h-[480px] w-[480px] rounded-full border-[54px] border-chrome-card"
        />
        <div
          aria-hidden
          className="absolute -bottom-24 -right-24 h-[300px] w-[300px] rounded-full border-[38px] border-accent/80"
        />
      </div>

      {/* ============ Form panel ============ */}
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          {/* Mobile brand header */}
          <div className="rise mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-accent text-chrome">
              <Icon name="spark" className="h-5 w-5" />
            </span>
            <div>
              <div className="text-base font-bold tracking-tight text-ink">Organization A</div>
              <div className="text-[10px] uppercase tracking-widest text-ink-faint">
                Operations
              </div>
            </div>
          </div>

          <div className="rise" style={{ animationDelay: "80ms" }}>
            <h2 className="text-3xl font-light tracking-tight text-ink">
              Welcome <span className="font-extrabold">back</span>
            </h2>
            <p className="mt-1 text-sm text-ink-soft">Sign in to pick up where you left off.</p>
          </div>

          <form
            key={shake}
            onSubmit={submit}
            className={`rise mt-6 rounded-3xl bg-surface p-6 shadow-card ${shake > 0 ? "shake" : ""}`}
            style={{ animationDelay: shake > 0 ? undefined : "160ms" }}
          >
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Username
              <input
                autoCapitalize="none"
                autoCorrect="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-line bg-raised px-3.5 py-2.5 text-sm font-medium text-ink outline-none transition-colors placeholder:font-normal placeholder:text-ink-faint focus:border-accent-strong focus:bg-surface"
                placeholder="Name"
              />
            </label>
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-line bg-raised px-3.5 py-2.5 text-sm font-medium text-ink outline-none transition-colors placeholder:font-normal placeholder:text-ink-faint focus:border-accent-strong focus:bg-surface"
                placeholder="••••••••"
              />
            </label>

            {error && (
              <p className="fade-in mt-3 rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="press mt-5 w-full rounded-xl bg-chrome px-4 py-2.5 text-sm font-semibold text-chrome-ink transition-colors hover:bg-chrome-card disabled:opacity-60"
            >
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[2px] border-chrome-ink/30 border-t-chrome-ink" />
                  Signing in…
                </span>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          {demoLogins.length > 0 && (
            <div className="rise mt-5 rounded-3xl border border-dashed border-line p-4" style={{ animationDelay: "240ms" }}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
                Demo logins — one tap
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {demoLogins.map((d, i) => (
                  <button
                    key={d.username}
                    onClick={() => quick(d.username, d.password)}
                    style={{ animationDelay: `${280 + i * 40}ms` }}
                    className="rise lift press rounded-2xl bg-surface px-3 py-2.5 text-left shadow-card"
                  >
                    <div className="text-sm font-semibold text-ink">{d.name}</div>
                    <div className="mt-0.5 text-[11px] text-ink-faint">
                      {d.username} · <span className="capitalize">{d.role}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
