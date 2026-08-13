import { getSessionUser } from "@/server/auth";
import { ShellClient } from "./shell-client";

/**
 * Server wrapper around the app chrome.
 *
 * The role used to arrive from a client `fetch("/api/me")` inside a
 * `useEffect`, so role-gated nav items were hidden on first paint and popped in
 * a moment later — an admin would watch their own menu assemble itself. Reading
 * the session here means the sidebar is correct immediately.
 *
 * Every page still writes `<Shell>…</Shell>`, unchanged.
 */
export async function Shell({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <ShellClient
      initialUser={
        user
          ? {
              displayName: user.displayName,
              role: user.role,
              mustChangePassword: user.mustChangePassword,
            }
          : null
      }
    >
      {children}
    </ShellClient>
  );
}
