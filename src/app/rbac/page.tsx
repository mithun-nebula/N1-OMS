import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { DEMO_PERMISSION_RULES, OPEN_NODE_TYPES } from "@/server/policy";
import { RBAC_ROLES } from "@/domains/shared/people-roster";
import { Shell } from "../shell";

const ACTIONS = ["view", "create", "edit", "approve", "export", "delete"] as const;

export default async function RbacPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "super-admin" && user.role !== "admin") redirect("/dashboard");

  const nodeTypes = [...new Set(DEMO_PERMISSION_RULES.map((r) => r.nodeType))].sort();

  function canDo(role: string, nodeType: string, action: string): "yes" | "no" | "open" {
    if (OPEN_NODE_TYPES.has(nodeType) && ["view", "create", "edit"].includes(action)) {
      return "open";
    }
    const matching = DEMO_PERMISSION_RULES.filter(
      (r) => r.role === role && r.nodeType === nodeType && r.actions.includes(action as never),
    );
    return matching.length > 0 ? "yes" : "no";
  }

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">RBAC — Roles &amp; Permissions</h1>
      </header>
      <div className="overflow-x-auto p-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[.08] text-left dark:border-white/[.1]">
              <th className="px-3 py-2 text-xs uppercase tracking-wide text-zinc-400">Role</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wide text-zinc-400">Node type</th>
              {ACTIONS.map((a) => (
                <th key={a} className="px-3 py-2 text-center text-xs uppercase tracking-wide text-zinc-400">{a}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RBAC_ROLES.flatMap((role) =>
              nodeTypes.map((nt) => (
                <tr key={`${role}-${nt}`} className="border-b border-black/[.04] dark:border-white/[.04]">
                  <td className="px-3 py-1.5 font-mono text-xs text-zinc-500">{role}</td>
                  <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-300">{nt}</td>
                  {ACTIONS.map((a) => {
                    const v = canDo(role, nt, a);
                    return (
                      <td key={a} className="px-3 py-1.5 text-center">
                        {v === "yes" && <span className="text-teal-600">✓</span>}
                        {v === "open" && <span className="text-xs text-amber-500">open</span>}
                        {v === "no" && <span className="text-zinc-300">—</span>}
                      </td>
                    );
                  })}
                </tr>
              )),
            )}
          </tbody>
        </table>
        <div className="mt-4 flex gap-4 text-xs text-zinc-400">
          <span><span className="text-teal-600">✓</span> explicitly granted</span>
          <span><span className="text-amber-500">open</span> open-to-all (calendar exemption / workplace)</span>
          <span>— not granted</span>
        </div>
      </div>
    </Shell>
  );
}
