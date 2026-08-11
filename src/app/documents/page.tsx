import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { findExpiringDocuments } from "@/domains/workplace/documents";
import { Shell } from "../shell";
import { DocumentsClient } from "./documents-client";

export default async function DocumentsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { deps } = await getWorld();
  const asOf = new Date().toISOString();

  const documents = (await deps.graph.find("document", () => true)).map((n) => {
    const d = n.data as Record<string, unknown>;
    return {
      id: n.id,
      name: String(d.name ?? n.id),
      nodeType: String(d.nodeType ?? ""),
      nodeId: String(d.nodeId ?? ""),
      version: Number(d.version ?? 0),
      required: Boolean(d.required),
      requiredBy: d.requiredBy ? String(d.requiredBy) : undefined,
      expiresOn: d.expiresOn ? String(d.expiresOn) : undefined,
      roleAccess: Array.isArray(d.roleAccess) ? (d.roleAccess as string[]) : [],
    };
  });

  const expiring = await findExpiringDocuments(deps.graph, asOf, 30);

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Documents</h1>
        <p className="text-sm text-zinc-400">Filed against records · version history · required tracking</p>
      </header>
      <DocumentsClient documents={documents} expiring={expiring} actorRole={user.role} />
    </Shell>
  );
}
