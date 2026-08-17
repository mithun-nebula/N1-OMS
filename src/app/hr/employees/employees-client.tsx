"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  FormActions,
  FormRow,
  Modal,
  PageBody,
  PageHeader,
  SelectField,
  TextField,
  type Column,
} from "@/components/ui";
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
          <Button size="sm" variant="ghost" onClick={() => setLeaving(p)}>
            Deactivate
          </Button>
        ) : null,
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
    if (result.status === "ran") {
      onAdded(effectiveUsername, password);
      setName("");
      setId("");
      setIdTouched(false);
      setUsername("");
      setContact("");
      setPassword("");
    }
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
        {op.error && <p className="text-sm text-rose-600">{op.error}</p>}
      </div>
      <FormActions>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} busy={op.busy} disabled={!ready}>
          Add
        </Button>
      </FormActions>
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

  async function submit() {
    if (!person) return;
    const result = await op.run("employee.deactivate", {
      employeeId: person.id,
      lastWorkingDay,
      reason,
    });
    if (result.status === "ran") {
      setLastWorkingDay("");
      setReason("");
      onClose();
    }
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
        {op.error && <p className="text-sm text-rose-600">{op.error}</p>}
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
    </Modal>
  );
}
