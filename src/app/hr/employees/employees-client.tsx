"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  DateField,
  FormActions,
  FormRow,
  Modal,
  PageBody,
  PageHeader,
  SelectField,
  TextField,
  type Column,
} from "@/components/ui";
import { OpFeedback } from "../../ui/kit";
import { useOperation } from "@/components/ops/use-operation";

export interface PersonRow {
  id: string;
  name: string;
  role: string;
  team: string;
  contact: string;
  username: string;
  managerName: string;
  active: boolean;
  joiningDate: string;
  lastWorkingDay: string;
}

/** Suggests an id from a name, so the two do not have to be typed separately. */
function suggestId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 39);
}

export function EmployeesClient({
  people,
  teams,
  assignableRoles,
}: {
  people: PersonRow[];
  teams: string[];
  assignableRoles: string[];
}) {
  const op = useOperation();
  const [adding, setAdding] = useState(false);
  const [leaving, setLeaving] = useState<PersonRow | null>(null);
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const [paying, setPaying] = useState<PersonRow | null>(null);
  const [returning, setReturning] = useState<PersonRow | null>(null);
  const [added, setAdded] = useState<{ username: string; password: string } | null>(null);

  const columns: Column<PersonRow>[] = [
    {
      key: "name",
      header: "Name",
      cell: (p) => (
        <div>
          <div className={p.active ? "font-semibold text-ink" : "text-ink-faint line-through"}>{p.name}</div>
          <div className="text-xs text-ink-faint">{p.username || p.id}</div>
        </div>
      ),
    },
    { key: "role", header: "Role", cell: (p) => <Badge>{p.role}</Badge> },
    { key: "team", header: "Team", cell: (p) => p.team || "—", hideOnMobile: true },
    {
      key: "manager",
      header: "Manager",
      cell: (p) => p.managerName || "—",
      hideOnMobile: true,
    },
    { key: "contact", header: "Contact", cell: (p) => p.contact || "—", hideOnMobile: true },
    {
      key: "status",
      header: "Status",
      cell: (p) =>
        p.active ? (
          <Badge tone="good">Active</Badge>
        ) : (
          <Badge tone="neutral">Left {p.lastWorkingDay}</Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (p) =>
        p.active ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPaying(p)}>
              Set pay
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLeaving(p)}>
              Deactivate
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setReturning(p)}>
            Reactivate
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="People"
        subtitle={`${people.filter((p) => p.active).length} active`}
        actions={<Button onClick={() => setAdding(true)}>Add someone</Button>}
      />
      <PageBody>
        {added && (
          <Card tone="attention">
            <CardHeader title="Share these once" />
            <p className="text-sm text-ink">
              <strong>{added.username}</strong> can sign in with{" "}
              <code className="rounded bg-raised px-1.5 py-0.5 font-mono">
                {added.password}
              </code>
              . They must set their own password before they can use anything, and
              this one stops working after seven days.
            </p>
            <FormActions>
              <Button size="sm" variant="ghost" onClick={() => setAdded(null)}>
                Done
              </Button>
            </FormActions>
          </Card>
        )}

        <Card>
          <CardHeader title="Everyone" />
          <DataTable
            columns={columns}
            rows={people}
            rowKey={(p) => p.id}
            empty="Nobody has been added yet."
          />
        </Card>
      </PageBody>

      <AddPersonModal
        open={adding}
        teams={teams}
        assignableRoles={assignableRoles}
        op={op}
        onClose={() => {
          setAdding(false);
          op.reset();
        }}
        onAdded={(username, password) => {
          setAdding(false);
          setAdded({ username, password });
        }}
      />

      <DeactivateModal
        person={leaving}
        op={op}
        onClose={() => {
          setLeaving(null);
          op.reset();
        }}
      />

      {editing && (
        <EditPersonModal
          key={editing.id}
          person={editing}
          op={op}
          onClose={() => {
            setEditing(null);
            op.reset();
          }}
        />
      )}

      {paying && (
        <SetPayModal
          key={paying.id}
          person={paying}
          op={op}
          onClose={() => {
            setPaying(null);
            op.reset();
          }}
        />
      )}

      {returning && (
        <ReactivateModal
          key={returning.id}
          person={returning}
          op={op}
          onClose={() => {
            setReturning(null);
            op.reset();
          }}
          onReactivated={(username, password) => {
            setReturning(null);
            setAdded({ username, password });
          }}
        />
      )}
    </>
  );
}

type Op = ReturnType<typeof useOperation>;

function AddPersonModal({
  open,
  teams,
  assignableRoles,
  op,
  onClose,
  onAdded,
}: {
  open: boolean;
  teams: string[];
  assignableRoles: string[];
  op: Op;
  onClose: () => void;
  onAdded: (username: string, password: string) => void;
}) {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState(assignableRoles[0] ?? "employee");
  const [team, setTeam] = useState(teams[0] ?? "");
  const [contact, setContact] = useState("");
  const [password, setPassword] = useState("");

  const effectiveId = idTouched ? id : suggestId(name);
  const effectiveUsername = username || effectiveId;

  function finish() {
    onAdded(effectiveUsername, password);
    setName("");
    setId("");
    setIdTouched(false);
    setUsername("");
    setContact("");
    setPassword("");
  }

  async function submit() {
    const result = await op.run("employee.create", {
      employeeId: effectiveId,
      name,
      role,
      username: effectiveUsername,
      temporaryPassword: password,
      team: team || undefined,
      contact: contact || undefined,
    });
    if (result.status === "ran") finish();
  }

  async function confirmParked() {
    const result = await op.confirm();
    if (result.status === "ran") finish();
  }

  const ready = name.trim() && effectiveId && effectiveUsername && password.length >= 6;

  return (
    <Modal open={open} onClose={onClose} title="Add someone">
      <div className="space-y-3">
        <FormRow>
          <TextField
            label="Full name"
            value={name}
            onChange={setName}
            placeholder="Ananya Sharma"
            error={op.missing.includes("name") ? "Required" : undefined}
          />
          <TextField
            label="Sign-in id"
            value={effectiveId}
            onChange={(v) => {
              setIdTouched(true);
              setId(v);
            }}
            hint="Lowercase letters, numbers and hyphens. Cannot be changed later."
            error={op.missing.includes("employeeId") ? "Not usable" : undefined}
          />
        </FormRow>
        <FormRow>
          <SelectField
            label="Role"
            value={role}
            onChange={setRole}
            options={assignableRoles.map((r) => ({ value: r, label: r }))}
            hint="You can only create roles below your own."
          />
          <TextField
            label="Team"
            value={team}
            onChange={setTeam}
            placeholder={teams[0] ?? "courses"}
            hint="Their manager is whoever manages this team."
          />
        </FormRow>
        <FormRow>
          <TextField
            label="Username"
            value={effectiveUsername}
            onChange={setUsername}
            error={op.missing.includes("username") ? "Taken" : undefined}
          />
          <TextField
            label="Contact"
            value={contact}
            onChange={setContact}
            placeholder="name@company.com"
          />
        </FormRow>
        <TextField
          label="Temporary password"
          value={password}
          onChange={setPassword}
          hint="They must replace this at first sign-in. It expires in seven days."
          error={op.missing.includes("temporaryPassword") ? "At least 6 characters" : undefined}
        />
      </div>
      <FormActions>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} busy={op.busy} disabled={!ready}>
          Add
        </Button>
      </FormActions>
      <OpFeedback
        error={op.error}
        confirmation={op.confirmation}
        busy={op.busy}
        onConfirm={confirmParked}
        onCancel={op.cancel}
        onDismiss={op.reset}
      />
    </Modal>
  );
}

/**
 * Edit name/team/contact. Role changes go through accounts, pay has its own
 * operation, and status is handled by deactivate — so none of those appear.
 */
function EditPersonModal({
  person,
  op,
  onClose,
}: {
  person: PersonRow;
  op: Op;
  onClose: () => void;
}) {
  const [name, setName] = useState(person.name);
  const [team, setTeam] = useState(person.team);
  const [contact, setContact] = useState(person.contact);

  const patch: Record<string, string> = {};
  if (name !== person.name) patch.name = name;
  if (team !== person.team) patch.team = team;
  if (contact !== person.contact) patch.contact = contact;

  async function submit() {
    const result = await op.run("employee.update", {
      employeeId: person.id,
      patch,
    });
    if (result.status === "ran") onClose();
  }

  async function confirmParked() {
    const result = await op.confirm();
    if (result.status === "ran") onClose();
  }

  const ready = name.trim().length > 0 && Object.keys(patch).length > 0;

  return (
    <Modal open onClose={onClose} title={`Edit ${person.name}`}>
      <div className="space-y-3">
        <FormRow>
          <TextField
            label="Full name"
            value={name}
            onChange={setName}
            error={op.missing.includes("name") ? "Not usable" : undefined}
          />
          <TextField
            label="Team"
            value={team}
            onChange={setTeam}
            hint="Their manager is whoever manages this team."
            error={op.missing.includes("team") ? "Not usable" : undefined}
          />
        </FormRow>
        <TextField
          label="Contact"
          value={contact}
          onChange={setContact}
          placeholder="name@company.com"
          error={op.missing.includes("contact") ? "Not usable" : undefined}
        />
      </div>
      <FormActions>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} busy={op.busy} disabled={!ready}>
          Save
        </Button>
      </FormActions>
      <OpFeedback
        error={op.error}
        confirmation={op.confirmation}
        busy={op.busy}
        onConfirm={confirmParked}
        onCancel={op.cancel}
        onDismiss={op.reset}
      />
    </Modal>
  );
}

function SetPayModal({
  person,
  op,
  onClose,
}: {
  person: PersonRow;
  op: Op;
  onClose: () => void;
}) {
  const [pay, setPay] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  async function submit() {
    const result = await op.run("employee.setPay", {
      employeeId: person.id,
      pay: Number(pay),
      effectiveFrom,
    });
    if (result.status === "ran") onClose();
  }

  async function confirmParked() {
    const result = await op.confirm();
    if (result.status === "ran") onClose();
  }

  const payNumber = Number(pay);
  const ready =
    pay.trim() !== "" && !Number.isNaN(payNumber) && payNumber >= 0 && !!effectiveFrom;

  return (
    <Modal open onClose={onClose} title={`Set ${person.name}'s pay`} width="sm">
      <p className="mb-4 text-sm text-ink-soft">
        Pay changes are recorded on their own and may need a confirmation before
        they apply.
      </p>
      <div className="space-y-3">
        <TextField
          label="Pay"
          type="number"
          value={pay}
          onChange={setPay}
          placeholder="50000"
          error={op.missing.includes("pay") ? "Must be a positive number" : undefined}
        />
        <DateField
          label="Effective from"
          value={effectiveFrom}
          onChange={setEffectiveFrom}
          error={op.missing.includes("effectiveFrom") ? "Required" : undefined}
        />
      </div>
      <FormActions>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} busy={op.busy} disabled={!ready}>
          Set pay
        </Button>
      </FormActions>
      <OpFeedback
        error={op.error}
        confirmation={op.confirmation}
        busy={op.busy}
        onConfirm={confirmParked}
        onCancel={op.cancel}
        onDismiss={op.reset}
      />
    </Modal>
  );
}

/**
 * Bringing someone back never revives their old login: the operation demands a
 * fresh temporary password (changed at first sign-in). Their username stays.
 */
function ReactivateModal({
  person,
  op,
  onClose,
  onReactivated,
}: {
  person: PersonRow;
  op: Op;
  onClose: () => void;
  onReactivated: (username: string, password: string) => void;
}) {
  const [password, setPassword] = useState("");

  function finish(result: { response?: unknown }) {
    const username =
      (result.response as { username?: string } | undefined)?.username ||
      person.username ||
      person.id;
    onReactivated(username, password);
  }

  async function submit() {
    const result = await op.run("employee.reactivate", {
      employeeId: person.id,
      temporaryPassword: password,
    });
    if (result.status === "ran") finish(result);
  }

  async function confirmParked() {
    const result = await op.confirm();
    if (result.status === "ran") finish(result);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Bring ${person.name} back`}
      width="sm"
    >
      <p className="mb-4 text-sm text-ink-soft">
        Their record and history are still here. Coming back means a fresh
        temporary password — their old one never starts working again.
      </p>
      <div className="space-y-3">
        <TextField
          label="Temporary password"
          value={password}
          onChange={setPassword}
          hint="They must replace this at first sign-in. It expires in seven days."
          error={
            op.missing.includes("temporaryPassword") ? "At least 6 characters" : undefined
          }
        />
      </div>
      <FormActions>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} busy={op.busy} disabled={password.length < 6}>
          Reactivate
        </Button>
      </FormActions>
      <OpFeedback
        error={op.error}
        confirmation={op.confirmation}
        busy={op.busy}
        onConfirm={confirmParked}
        onCancel={op.cancel}
        onDismiss={op.reset}
      />
    </Modal>
  );
}

function DeactivateModal({
  person,
  op,
  onClose,
}: {
  person: PersonRow | null;
  op: Op;
  onClose: () => void;
}) {
  const [lastWorkingDay, setLastWorkingDay] = useState("");
  const [reason, setReason] = useState("");

  function finish() {
    setLastWorkingDay("");
    setReason("");
    onClose();
  }

  async function submit() {
    if (!person) return;
    const result = await op.run("employee.deactivate", {
      employeeId: person.id,
      lastWorkingDay,
      reason,
    });
    if (result.status === "ran") finish();
  }

  async function confirmParked() {
    const result = await op.confirm();
    if (result.status === "ran") finish();
  }

  return (
    <Modal
      open={person !== null}
      onClose={onClose}
      title={person ? `${person.name} is leaving` : ""}
      width="sm"
    >
      <p className="mb-4 text-sm text-ink-soft">
        Their record and history stay. Their login stops working.
      </p>
      <div className="space-y-3">
        <TextField
          label="Last working day"
          type="text"
          value={lastWorkingDay}
          onChange={setLastWorkingDay}
          placeholder="2026-09-30"
        />
        <TextField
          label="Reason"
          value={reason}
          onChange={setReason}
          placeholder="Resigned"
        />
      </div>
      <FormActions>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={submit}
          busy={op.busy}
          disabled={!lastWorkingDay || !reason}
        >
          Deactivate
        </Button>
      </FormActions>
      <OpFeedback
        error={op.error}
        confirmation={op.confirmation}
        busy={op.busy}
        onConfirm={confirmParked}
        onCancel={op.cancel}
        onDismiss={op.reset}
      />
    </Modal>
  );
}
