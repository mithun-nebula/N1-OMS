import { env } from "@/config/env";
import { LoginForm, type DemoLogin } from "./login-client";

// Rendered per request, not at build time: `seedDemo` is read from the
// environment, and a statically prerendered page would bake in whatever value
// was set when the bundle was built.
export const dynamic = "force-dynamic";

/**
 * The demo credentials live **here, on the server**, not in the client module.
 *
 * They used to be a top-level const inside the client component, which meant
 * all six username/password pairs were compiled into the JavaScript bundle and
 * shipped to every browser — hiding the grid with a flag would not have removed
 * them. Passing them as a prop means that when demo mode is off, the array is
 * empty and the passwords are not in the payload at all.
 */
const DEMO_LOGINS: DemoLogin[] = [
  { username: "superadmin", password: "super123", role: "super-admin", name: "Super Admin" },
  { username: "admin", password: "admin123", role: "admin", name: "Administrator" },
  { username: "hr", password: "hr123", role: "hr", name: "Shruti" },
  { username: "manager", password: "manager123", role: "manager", name: "James D." },
  { username: "employee", password: "employee123", role: "employee", name: "Priya R." },
  { username: "intern", password: "intern123", role: "intern", name: "Ravi" },
];

export default function LoginPage() {
  return <LoginForm demoLogins={env().seedDemo ? DEMO_LOGINS : []} />;
}
