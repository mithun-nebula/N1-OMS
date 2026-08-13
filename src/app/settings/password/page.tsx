import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { ForcedPasswordChange } from "./forced-password-client";

/**
 * The only page reachable while an account still carries a temporary password.
 * Deliberately outside `<Shell>` — the person cannot use the app yet, so
 * showing them navigation they cannot follow would be misleading.
 *
 * Someone who is not flagged can still open this page to change their password
 * voluntarily; they just also have the version on `/settings`.
 */
export default async function PasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.12] dark:bg-black">
        <h1 className="text-lg font-semibold text-black dark:text-zinc-50">
          {user.mustChangePassword ? "Set your password" : "Change password"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {user.mustChangePassword
            ? "Your account was created with a temporary password. Choose your own before continuing."
            : `Signed in as ${user.displayName}.`}
        </p>
        <ForcedPasswordChange forced={user.mustChangePassword === true} />
      </div>
    </main>
  );
}
