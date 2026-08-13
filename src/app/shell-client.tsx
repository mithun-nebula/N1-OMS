"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { VoiceButton } from "./voice-input";
import { GlobalSearch } from "./chrome/global-search";
import { NotificationsBell } from "./chrome/notifications";
import { ThemeToggle } from "./chrome/theme-toggle";

interface NavItem {
  href: string;
  label: string;
  roles?: string[];
}

const PRIMARY: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/tasks", label: "Tasks" },
  { href: "/meetings", label: "Meetings" },
  { href: "/booking", label: "Booking" },
  { href: "/courses", label: "Projects" },
  { href: "/calendar", label: "Calendar" },
  { href: "/team", label: "Team" },
  { href: "/leave", label: "Leave" },
];

const SECONDARY: NavItem[] = [
  { href: "/documents", label: "Documents" },
  { href: "/announcements", label: "Announcements" },
  { href: "/events", label: "Events" },
  { href: "/equipment", label: "Equipment" },
  { href: "/utilities", label: "Utilities" },
  { href: "/decisions", label: "Decisions" },
  { href: "/expenses", label: "Expenses & travel" },
  { href: "/records", label: "Records (N1)" },
  { href: "/payroll", label: "Payroll", roles: ["super-admin", "admin", "hr"] },
  { href: "/hr/employees", label: "People", roles: ["super-admin", "admin", "hr", "manager"] },
  { href: "/hr", label: "HR · Joining/Leaving", roles: ["super-admin", "admin", "hr"] },
  { href: "/me", label: "Profile" },
  { href: "/settings", label: "Settings" },
  { href: "/rbac", label: "RBAC", roles: ["super-admin", "admin"] },
  { href: "/admin", label: "Admin", roles: ["super-admin", "admin"] },
];

function visible(items: NavItem[], role: string): NavItem[] {
  return items.filter((i) => !i.roles || i.roles.includes(role));
}

export interface ShellUser {
  displayName: string;
  role: string;
  mustChangePassword?: boolean;
}

export function ShellClient({
  children,
  initialUser,
}: {
  children: React.ReactNode;
  initialUser: ShellUser | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Seeded from the server, so role-gated nav is correct on the very first
  // paint. It used to arrive from a client fetch, which made admin-only items
  // visibly pop in a moment after load.
  const [user, setUser] = useState<ShellUser | null>(initialUser);

  useEffect(() => {
    // One re-check against the live account: an admin resetting this person's
    // password mid-session is not in the session cookie the server read.
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.user) return;
        if (d.user.mustChangePassword) {
          router.replace("/settings/password");
          return;
        }
        setUser(d.user);
      })
      .catch(() => {});
  }, [router]);

  const role = user?.role ?? "";
  const navItems = visible(PRIMARY, role);
  const secondary = visible(SECONDARY, role);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-black">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-black/[.08] bg-white dark:border-white/[.1] dark:bg-black md:flex">
        <div className="px-5 py-5">
          <div className="text-xs font-medium uppercase tracking-widest text-teal-700 dark:text-teal-400">
            Organization A
          </div>
          <div className="mt-3">
            <GlobalSearch />
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} active={pathname === item.href} />
          ))}
          <div className="px-3 pb-1 pt-4 text-[10px] font-medium uppercase tracking-widest text-zinc-300 dark:text-zinc-600">
            More
          </div>
          {secondary.map((item) => (
            <NavLink key={item.href} item={item} active={pathname === item.href} />
          ))}
        </nav>
        <div className="border-t border-black/[.08] px-5 py-4 dark:border-white/[.1]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-black dark:text-zinc-50">{user?.displayName ?? "…"}</div>
              <div className="text-xs text-zinc-400">{user?.role}</div>
            </div>
            <NotificationsBell />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <ThemeToggle />
            <button onClick={logout} className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 overflow-x-hidden">
        <div className="border-b border-black/[.06] px-6 py-3 dark:border-white/[.06] md:hidden">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-black dark:text-zinc-50">Organization A</span>
            <div className="flex items-center gap-3">
              <NotificationsBell />
              <button onClick={logout} className="text-xs text-zinc-500">Sign out</button>
            </div>
          </div>
          <div className="mt-2">
            <GlobalSearch />
          </div>
        </div>
        {children}
      </div>

      <MobileBottomNav role={role} />
      <VoiceButton />
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-teal-700/10 text-teal-700 dark:text-teal-300"
          : "text-zinc-600 hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
      }`}
    >
      {item.label}
    </Link>
  );
}

function MobileBottomNav({ role }: { role: string }) {
  const pathname = usePathname();
  const [openMore, setOpenMore] = useState(false);
  const items = [
    { href: "/dashboard", label: "Home", icon: "▢" },
    { href: "/calendar", label: "Calendar", icon: "▦" },
    { href: "/team", label: "Team", icon: "◔" },
  ];
  const more = visible(SECONDARY, role).concat(visible(PRIMARY, role).filter((p) => !items.some((i) => i.href === p.href)));

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-black/[.08] bg-white py-1.5 dark:border-white/[.1] dark:bg-black md:hidden">
      {items.map((it) => (
        <Link key={it.href} href={it.href} className={`flex flex-col items-center px-3 py-1 text-[10px] ${pathname === it.href ? "text-teal-700 dark:text-teal-400" : "text-zinc-400"}`}>
          <span className="text-base">{it.icon}</span>
          {it.label}
        </Link>
      ))}
      <Link href="/dashboard" className="flex flex-col items-center px-3 py-1 text-[10px] text-teal-700 dark:text-teal-400">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-sm text-white">✦</span>
      </Link>
      <button onClick={() => setOpenMore(!openMore)} className="flex flex-col items-center px-3 py-1 text-[10px] text-zinc-400">
        <span className="text-base">≡</span>
        More
      </button>
      {openMore && (
        <div className="absolute bottom-14 right-2 w-48 overflow-hidden rounded-xl border border-black/[.1] bg-white shadow-lg dark:border-white/[.15] dark:bg-black">
          {more.map((m) => (
            <Link key={m.href} href={m.href} onClick={() => setOpenMore(false)} className="block px-3 py-2 text-xs text-zinc-600 hover:bg-teal-700/5 dark:text-zinc-300">
              {m.label}
            </Link>
          ))}
          <div className="border-t border-black/[.06] px-3 py-2 dark:border-white/[.06]">
            <ThemeToggle />
          </div>
        </div>
      )}
    </nav>
  );
}
