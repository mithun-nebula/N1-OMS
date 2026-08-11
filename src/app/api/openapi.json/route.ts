import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const spec = {
  openapi: "3.1.0",
  info: { title: "Organization A spine API", version: "1.0.0" },
  paths: {
    "/api/health": { get: { summary: "Health check", tags: ["system"] } },
    "/api/auth/login": { post: { summary: "Sign in", tags: ["auth"] } },
    "/api/auth/logout": { post: { summary: "Sign out", tags: ["auth"] } },
    "/api/me": { get: { summary: "Current session user", tags: ["auth"] } },
    "/api/operations": { post: { summary: "Submit an operation (seven starts)", tags: ["operations"] } },
    "/api/operations/{id}/confirm": { post: { summary: "Confirm a pending operation", tags: ["operations"] } },
    "/api/records/{type}/{id}": { get: { summary: "Read-through with field permission", tags: ["records"] } },
    "/api/figures/{type}/{id}": { get: { summary: "Figure + computed-from breakdown", tags: ["figures"] } },
    "/api/activity": { get: { summary: "Query the activity log", tags: ["activity"] } },
    "/api/people/{id}": { get: { summary: "Employee directory (field-filtered)", tags: ["people"] } },
    "/api/people/{id}/leave-balance": { get: { summary: "Leave balance", tags: ["people"] } },
    "/api/people/{id}/attendance": { get: { summary: "Attendance read-through", tags: ["people"] } },
    "/api/people/{id}/payslips": { get: { summary: "Pay slips (hr/admin/self)", tags: ["people"] } },
    "/api/courses/progress": { get: { summary: "Team course progress", tags: ["courses"] } },
    "/api/courses/{id}": { get: { summary: "Course detail + figure", tags: ["courses"] } },
    "/api/courses/{id}/deck": { post: { summary: "Generate deck outline (LLM seam)", tags: ["courses"] } },
    "/api/org-memory": { get: { summary: "List org-memories", tags: ["org-memory"] }, post: { summary: "Record a decision", tags: ["org-memory"] } },
    "/api/org-memory/{id}": { get: { summary: "Retrieve (links permission-filtered)", tags: ["org-memory"] } },
    "/api/calendar/{year}/{month}": { get: { summary: "Month view", tags: ["calendar"] } },
    "/api/announcements": { get: { summary: "List announcements", tags: ["announcements"] }, post: { summary: "Send", tags: ["announcements"] } },
    "/api/announcements/{id}": { get: { summary: "Announcement + non-ackers", tags: ["announcements"] } },
    "/api/assistant/ask": { post: { summary: "Coordinator answer (permission-bound)", tags: ["assistant"] } },
    "/api/notifications": { get: { summary: "Notifications for the session actor", tags: ["notifications"] } },
    "/api/search": { get: { summary: "Global search (permission-filtered)", tags: ["search"] } },
    "/api/export": { get: { summary: "Export CSV (gated by canExport)", tags: ["export"] } },
    "/api/activity/{id}/undo": { post: { summary: "Undo an action by activity entry id", tags: ["activity"] } },
    "/api/settings/password": { post: { summary: "Change own password", tags: ["settings"] } },
    "/api/autonomy/tick": { post: { summary: "Background tick (Cloud Scheduler)", tags: ["autonomy"] } },
    "/api/autonomy/rules": { get: { summary: "Rules + suggestions", tags: ["autonomy"] }, post: { summary: "Accept/revoke/detect", tags: ["autonomy"] } },
    "/api/openapi.json": { get: { summary: "This spec", tags: ["system"] } },
  },
  components: {
    schemas: {
      Operation: { type: "object", properties: { name: { type: "string" }, args: { type: "object" }, startedBy: { type: "object" }, authority: { type: "object" } } },
      RestrictedField: { type: "object", properties: { __restricted: { type: "boolean", const: true }, label: { type: "string" } } },
    },
  },
};

export async function GET() {
  return NextResponse.json(spec);
}
