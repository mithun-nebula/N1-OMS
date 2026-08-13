import type { ActorId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";
import { DEMO_PEOPLE, type RbacRole } from "./people-roster";

/**
 * Who works here.
 *
 * Replaces the hardcoded `DEMO_PEOPLE` map that ~25 files read from. Employees
 * are now real records in the graph; this is the in-memory index of them.
 *
 * **Reads are synchronous, and must stay that way.** `RoleProvider.rolesFor` /
 * `teamOf` / `ownerOf` are called from inside the gate, which is synchronous by
 * design, and `roleOfActor()` is too. So the directory is hydrated once at boot
 * (and again after any `employee.*` operation) and read without I/O after that.
 */

export interface DirectoryPerson {
  id: ActorId;
  name: string;
  role: RbacRole;
  team?: string;
  /** Set directly on the employee. Reporting lines proper arrive in Block 2. */
  managerId?: string;
  departmentId?: string;
  designationId?: string;
  contact?: string;
  active: boolean;
}

interface EmployeeNodeData {
  name?: string;
  role?: string;
  team?: string;
  managerId?: string;
  departmentId?: string;
  designationId?: string;
  contact?: string;
  status?: string;
}

export class PeopleDirectory {
  private people = new Map<ActorId, DirectoryPerson>();

  // ── reads (all synchronous) ──────────────────────────────────────────────

  get(id: ActorId): DirectoryPerson | undefined {
    return this.people.get(id);
  }

  all(): DirectoryPerson[] {
    return [...this.people.values()];
  }

  /** Everyone still working here. Deactivated people keep their record. */
  activeIds(): ActorId[] {
    return this.all()
      .filter((p) => p.active)
      .map((p) => p.id);
  }

  isActive(id: ActorId): boolean {
    return this.people.get(id)?.active === true;
  }

  nameOf(id: ActorId): string {
    // Falling back to the id keeps a deleted or unknown actor readable in the
    // UI rather than rendering an empty cell.
    return this.people.get(id)?.name ?? id;
  }

  roleOf(id: ActorId): RbacRole | undefined {
    return this.people.get(id)?.role;
  }

  teamNameOf(id: ActorId): string | undefined {
    return this.people.get(id)?.team;
  }

  /** Active members of a team. */
  membersOfTeam(team: string): ActorId[] {
    return this.all()
      .filter((p) => p.active && p.team === team)
      .map((p) => p.id);
  }

  /**
   * Who leads a team: its manager.
   *
   * Derived from the data rather than a hardcoded lookup, so a newly created
   * manager leads their team without anyone editing a constant. Block 2
   * replaces this with real `reports-to` edges.
   */
  leadOfTeam(team: string): ActorId | undefined {
    return this.all().find((p) => p.active && p.team === team && p.role === "manager")?.id;
  }

  /** A person's manager: explicit if set, otherwise their team's lead. */
  managerOf(id: ActorId): ActorId | undefined {
    const person = this.people.get(id);
    if (!person) return undefined;
    if (person.managerId && person.managerId !== id) return person.managerId;
    const lead = person.team ? this.leadOfTeam(person.team) : undefined;
    return lead === id ? undefined : lead;
  }

  /**
   * The line of managers above someone, nearest first.
   *
   * Guarded against loops rather than trusting the data: a cycle would
   * otherwise spin forever, and the data is only as good as whoever typed it.
   */
  chainOfCommand(id: ActorId): ActorId[] {
    const chain: ActorId[] = [];
    const seen = new Set<ActorId>([id]);
    let current = this.managerOf(id);
    while (current && !seen.has(current)) {
      chain.push(current);
      seen.add(current);
      current = this.managerOf(current);
    }
    return chain;
  }

  /**
   * Whether making `managerId` the manager of `employeeId` would close a loop.
   *
   * A loop is not just untidy: `employee.deactivate` refuses while someone
   * still manages people, so two people managing each other could never be
   * deactivated, and an approval routed up the chain would never terminate.
   */
  wouldCreateCycle(employeeId: ActorId, managerId: ActorId): boolean {
    if (employeeId === managerId) return true;
    // Walk up from the proposed manager. Reaching the employee closes the loop.
    const seen = new Set<ActorId>();
    let current: ActorId | undefined = managerId;
    while (current && !seen.has(current)) {
      if (current === employeeId) return true;
      seen.add(current);
      current = this.managerOf(current);
    }
    return false;
  }

  /** Everyone who reports to this person. */
  reportsOf(id: ActorId): ActorId[] {
    return this.all()
      .filter((p) => p.active && p.id !== id && this.managerOf(p.id) === id)
      .map((p) => p.id);
  }

  /** The team scope the permission layer uses: the lead plus the members. */
  teamCircleOf(actor: ActorId): ActorId[] {
    const team = this.teamNameOf(actor);
    if (!team) return [];
    const members = this.membersOfTeam(team);
    const lead = this.leadOfTeam(team);
    return lead && !members.includes(lead) ? [lead, ...members] : members;
  }

  /** Find someone by (partial, case-insensitive) name. */
  findByName(query: string): DirectoryPerson | undefined {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    return this.all().find((p) => p.active && p.name.toLowerCase().includes(q));
  }

  teams(): string[] {
    return [...new Set(this.all().filter((p) => p.team).map((p) => p.team as string))];
  }

  // ── writes ───────────────────────────────────────────────────────────────

  upsert(person: DirectoryPerson): void {
    this.people.set(person.id, person);
  }

  remove(id: ActorId): void {
    this.people.delete(id);
  }

  clear(): void {
    this.people.clear();
  }

  /**
   * Rebuild from the graph. Called at boot and after any `employee.*` change.
   *
   * With no employee records at all — a fresh database before anyone has been
   * added — it falls back to the demo roster so a development environment still
   * works. That fallback goes away once the graph is the only source.
   */
  async hydrate(graph: RecordStore): Promise<void> {
    const nodes = await graph.find("employee", () => true);
    this.people.clear();

    if (nodes.length === 0) {
      for (const [id, person] of Object.entries(DEMO_PEOPLE)) {
        this.people.set(id, {
          id,
          name: person.name,
          role: person.role,
          team: person.team,
          active: true,
        });
      }
      return;
    }

    for (const node of nodes) {
      const d = node.data as EmployeeNodeData;
      this.people.set(node.id, {
        id: node.id,
        name: d.name ?? node.id,
        role: (d.role as RbacRole) ?? "employee",
        team: d.team,
        managerId: d.managerId,
        departmentId: d.departmentId,
        designationId: d.designationId,
        contact: d.contact,
        // Anything not explicitly stood down counts as working here.
        active: d.status !== "inactive" && d.status !== "separated",
      });
    }
  }
}
