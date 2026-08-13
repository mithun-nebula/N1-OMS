"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
      return;
    }
    setError("Invalid username or password.");
  }

  async function quick(username: string, password: string) {
    setUsername(username);
    setPassword(password);
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
      return;
    }
    setError("Login failed.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="text-xs font-medium uppercase tracking-widest text-teal-700 dark:text-teal-400">
            Organization A
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Sign in
          </h1>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-black"
        >
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Username
            <input
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/[.12] bg-white px-3 py-2 text-black outline-none focus:border-teal-600 dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
              placeholder="Name"
            />
          </label>
          <label className="mt-4 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/[.12] bg-white px-3 py-2 text-black outline-none focus:border-teal-600 dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-5 w-full rounded-lg bg-teal-700 px-4 py-2 font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {demoLogins.length > 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-black/[.15] p-4 dark:border-white/[.2]">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Demo logins (one tap)
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {demoLogins.map((d) => (
                <button
                  key={d.username}
                  onClick={() => quick(d.username, d.password)}
                  className="rounded-lg border border-black/[.08] bg-white px-3 py-2 text-left text-sm transition-colors hover:border-teal-600 dark:border-white/[.15] dark:bg-black"
                >
                  <div className="font-medium text-black dark:text-zinc-50">
                    {d.name}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {d.username} · {d.role}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
