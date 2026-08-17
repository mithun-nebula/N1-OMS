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
    <main className="flex min-h-screen items-center justify-center bg-base p-6">
      <div className="pop-in w-full max-w-sm rounded-3xl bg-surface p-6 shadow-card">
        <h1 className="text-2xl font-light tracking-tight text-ink">
          {user.mustChangePassword ? (
            <>Set your <span className="font-extrabold">password</span></>
          ) : (
            <>Change <span className="font-extrabold">password</span></>
          )}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {user.mustChangePassword
            ? "Your account was created with a temporary password. Choose your own before continuing."
            : `Signed in as ${user.displayName}.`}
        </p>
        <ForcedPasswordChange forced={user.mustChangePassword === true} />
      </div>
    </main>
  );
}
