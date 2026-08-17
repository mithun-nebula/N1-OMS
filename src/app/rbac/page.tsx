import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { DEMO_PERMISSION_RULES, OPEN_NODE_TYPES } from "@/server/policy";
import { RBAC_ROLES } from "@/domains/shared/people-roster";
import { isAdminLike } from "@/server/roles";
import { Shell } from "../shell";

const ACTIONS = ["view", "create", "edit", "approve", "export", "delete"] as const;

export default async function RbacPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminLike(user.role)) redirect("/dashboard");

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
      <header className="rise px-4 pt-6 sm:px-6">
        <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
          Permission <span className="font-extrabold">matrix</span>
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          What each role may do, per record type. View only — the gate decides.
        </p>
      </header>
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <div className="rise mb-4 flex flex-wrap gap-4 text-xs text-ink-soft" style={{ animationDelay: "60ms" }}>
          <span className="flex items-center gap-1.5">
            <span className="grid h-4 w-4 place-items-center rounded-full bg-mint text-[10px] font-bold text-mint-strong">✓</span>
            explicitly granted
          </span>
          <span className="flex items-center gap-1.5">
            <span className="rounded-full bg-peach px-2 py-0.5 text-[10px] font-bold text-peach-strong">open</span>
            open-to-all (calendar exemption / workplace)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-ink-faint">—</span> not granted
          </span>
        </div>
        <div className="rise overflow-x-auto rounded-3xl bg-surface p-4 shadow-card" style={{ animationDelay: "120ms" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">Role</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">Record type</th>
                {ACTIONS.map((a) => (
                  <th key={a} className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-widest text-ink-faint">{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RBAC_ROLES.flatMap((role) =>
                nodeTypes.map((nt, i) => (
                  <tr
                    key={`${role}-${nt}`}
                    className={`border-t border-line transition-colors hover:bg-raised ${i === 0 ? "border-t-2" : ""}`}
                  >
                    <td className="px-3 py-1.5">
                      {i === 0 && (
                        <span className="rounded-full bg-chrome px-2.5 py-0.5 text-[10px] font-bold capitalize text-chrome-ink">
                          {role}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-[13px] text-ink">{nt}</td>
                    {ACTIONS.map((a) => {
                      const v = canDo(role, nt, a);
                      return (
                        <td key={a} className="px-3 py-1.5 text-center">
                          {v === "yes" && <span className="font-bold text-mint-strong">✓</span>}
                          {v === "open" && <span className="rounded-full bg-peach px-1.5 py-0.5 text-[9px] font-bold text-peach-strong">open</span>}
                          {v === "no" && <span className="text-line">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
