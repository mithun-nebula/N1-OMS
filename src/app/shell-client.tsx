"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { VoiceButton } from "./voice-input";
import { GlobalSearch } from "./chrome/global-search";
import { NotificationsBell } from "./chrome/notifications";
import { ThemeToggle } from "./chrome/theme-toggle";
import { Icon, type IconName } from "./ui/icons";

interface NavItem {
  href: string;
  label: string;
  icon?: IconName;
  roles?: string[];
}

const PRIMARY: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "home" },
  { href: "/tasks", label: "Tasks", icon: "tasks" },
  { href: "/meetings", label: "Meetings", icon: "meetings" },
  { href: "/booking", label: "Booking", icon: "booking" },
  { href: "/courses", label: "Projects", icon: "projects" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/team", label: "Team", icon: "team" },
  { href: "/leave", label: "Leave", icon: "leave" },
];

const SECONDARY: NavItem[] = [
  { href: "/documents", label: "Documents" },
  { href: "/announcements", label: "Announcements" },
  { href: "/events", label: "Events" },
  { href: "/equipment", label: "Equipment" },
  { href: "/utilities", label: "Utilities" },
  { href: "/decisions", label: "Decisions" },
  // Expenses is deliberately absent: the page is read-only and routes nowhere
  // yet — a dead end in the menu. It returns when claims actually work here.
  // Records is a raw browser over 162 HR record types — an admin tool, not an
  // everyone destination.
  { href: "/records", label: "Records (N1)", roles: ["super-admin", "admin"] },
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
  const initials = (user?.displayName ?? "…")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen bg-base">
      {/* ============ Desktop sidebar — deep teal chrome ============ */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-chrome text-chrome-ink md:flex">
        <div className="px-5 pb-4 pt-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-chrome">
              <Icon name="spark" className="h-4.5 w-4.5" />
            </span>
            <div>
              <div className="text-sm font-bold tracking-tight">Organization A</div>
              <div className="text-[10px] uppercase tracking-widest text-chrome-soft">
                Operations
              </div>
            </div>
          </div>
          <div className="mt-4">
            <GlobalSearch />
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} active={pathname === item.href} />
          ))}
          <MoreSection items={secondary} pathname={pathname} />
        </nav>

        <div className="border-t border-chrome-line px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-chrome-card text-xs font-bold text-accent">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{user?.displayName ?? "…"}</div>
              <div className="truncate text-[11px] capitalize text-chrome-soft">{user?.role}</div>
            </div>
            <NotificationsBell />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <ThemeToggle />
            <button
              onClick={logout}
              className="press flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-chrome-soft transition-colors hover:bg-white/[.06] hover:text-chrome-ink"
            >
              <Icon name="logout" className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 overflow-x-hidden">
        {/* ============ Mobile top bar ============ */}
        <div className="sticky top-0 z-20 bg-chrome px-4 py-3 text-chrome-ink md:hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-chrome">
                <Icon name="spark" className="h-3.5 w-3.5" />
              </span>
              <span className="text-sm font-bold">Organization A</span>
            </div>
            <div className="flex items-center gap-3">
              <NotificationsBell />
              <button onClick={logout} title="Sign out" className="press text-chrome-soft">
                <Icon name="logout" className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mt-2.5">
            <GlobalSearch />
          </div>
        </div>

        <main className="pb-24 md:pb-0">{children}</main>
      </div>

      <MobileBottomNav role={role} />
      <VoiceButton />
    </div>
  );
}

function MoreSection({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const containsCurrent = items.some((i) => i.href === pathname);
  // Open when the current page lives inside it, so the active item is never hidden.
  const [open, setOpen] = useState(containsCurrent);
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    // Adjust-state-during-render: reopen when navigating into a hidden item.
    setPrevPath(pathname);
    if (containsCurrent && !open) setOpen(true);
  }

  return (
    <div className="pt-4">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="press flex w-full items-center justify-between rounded-xl px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-chrome-soft/80 transition-colors hover:bg-white/[.06] hover:text-chrome-ink"
      >
        More
        <span
          className={`transition-transform duration-300 ${open ? "rotate-90" : ""}`}
        >
          <Icon name="arrow" className="h-3 w-3" />
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="min-h-0 space-y-0.5 overflow-hidden">
          {items.map((item, i) => (
            <div
              key={item.href}
              className={open ? "rise" : ""}
              style={open ? { animationDelay: `${Math.min(i * 25, 250)}ms` } : undefined}
            >
              <NavLink item={item} active={pathname === item.href} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={`group flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-200 ${
        active
          ? "bg-accent text-chrome shadow-[0_4px_14px_-4px_rgb(240_154_62/0.55)]"
          : "text-chrome-soft hover:bg-white/[.06] hover:text-chrome-ink"
      }`}
    >
      {item.icon && (
        <Icon
          name={item.icon}
          className={`h-4 w-4 transition-transform duration-200 ${
            active ? "" : "group-hover:-translate-y-px group-hover:scale-105"
          }`}
        />
      )}
      {item.label}
      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-chrome/70" />}
    </Link>
  );
}

function MobileBottomNav({ role }: { role: string }) {
  const pathname = usePathname();
  const [openMore, setOpenMore] = useState(false);

  const items: NavItem[] = [
    { href: "/dashboard", label: "Home", icon: "home" },
    { href: "/calendar", label: "Calendar", icon: "calendar" },
    { href: "/tasks", label: "Tasks", icon: "tasks" },
    { href: "/team", label: "Team", icon: "team" },
  ];
  const everything = visible(PRIMARY, role)
    .concat(visible(SECONDARY, role))
    .filter((m, i, arr) => arr.findIndex((x) => x.href === m.href) === i);

  return (
    <>
      {/* Floating pill nav with a center action button. */}
      <nav className="fixed bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full bg-chrome/95 px-3 py-1.5 text-chrome-ink shadow-lift backdrop-blur md:hidden">
        {items.slice(0, 2).map((it) => (
          <MobileTab key={it.href} item={it} active={pathname === it.href} />
        ))}
        <button
          onClick={() => setOpenMore(true)}
          aria-label="All destinations"
          className="press mx-1 grid h-11 w-11 place-items-center rounded-full bg-accent text-chrome shadow-[0_6px_16px_-4px_rgb(240_154_62/0.6)]"
        >
          <Icon name="grid" className="h-5 w-5" />
        </button>
        {items.slice(2).map((it) => (
          <MobileTab key={it.href} item={it} active={pathname === it.href} />
        ))}
      </nav>

      {/* Slide-up sheet with every destination. */}
      {openMore && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal>
          <button
            aria-label="Close menu"
            onClick={() => setOpenMore(false)}
            className="fade-in absolute inset-0 bg-chrome-deep/60 backdrop-blur-sm"
          />
          <div className="sheet-up absolute inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto rounded-t-3xl bg-surface p-5 pb-8 shadow-lift">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
            <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-ink-faint">
              Go to
            </div>
            <div className="grid grid-cols-3 gap-2">
              {everything.map((m, i) => (
                <Link
                  key={m.href}
                  href={m.href}
                  onClick={() => setOpenMore(false)}
                  style={{ animationDelay: `${Math.min(i * 22, 300)}ms` }}
                  className={`rise press flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center text-[11px] font-medium ${
                    pathname === m.href
                      ? "bg-accent-soft text-accent-ink"
                      : "bg-raised text-ink-soft"
                  }`}
                >
                  {m.icon ? (
                    <Icon name={m.icon} className="h-5 w-5" />
                  ) : (
                    <span className="grid h-5 w-5 place-items-center text-sm font-bold">
                      {m.label[0]}
                    </span>
                  )}
                  {m.label}
                </Link>
              ))}
            </div>
            <div className="mt-4 flex justify-center border-t border-line pt-4">
              <ThemeToggle />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MobileTab({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={`press flex flex-col items-center gap-0.5 rounded-full px-3 py-1.5 text-[9.5px] font-medium transition-colors ${
        active ? "text-accent" : "text-chrome-soft"
      }`}
    >
      {item.icon && <Icon name={item.icon} className="h-5 w-5" />}
      {item.label}
    </Link>
  );
}
