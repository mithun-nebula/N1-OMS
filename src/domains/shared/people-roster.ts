export type RbacRole =
  | "super-admin"
  | "admin"
  | "hr"
  | "manager"
  | "employee"
  | "intern";

export const RBAC_ROLES: RbacRole[] = [
  "super-admin",
  "admin",
  "hr",
  "manager",
  "employee",
  "intern",
];

export interface DemoPerson {
  name: string;
  role: RbacRole;
  team: string;
}

export const DEMO_PEOPLE: Record<string, DemoPerson> = {
  james: { name: "James D.", role: "manager", team: "courses" },
  priya: { name: "Priya R.", role: "employee", team: "courses" },
  arun: { name: "Arun S.", role: "employee", team: "courses" },
  karthik: { name: "Karthik V.", role: "employee", team: "courses" },
  divya: { name: "Divya M.", role: "employee", team: "courses" },
  meena: { name: "Meena K.", role: "employee", team: "courses" },
  shruti: { name: "Shruti", role: "hr", team: "ops" },
  ravi: { name: "Ravi", role: "intern", team: "ops" },
  naveen: { name: "Naveen", role: "intern", team: "ops" },
};

export const DEMO_TEAM_LEADS: Record<string, string> = {
  courses: "james",
};
