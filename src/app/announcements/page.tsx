import { redirect } from "next/navigation";

/**
 * Announcements were replaced wholesale by the messaging system (chat with
 * an Everyone group) — old links and muscle memory land in the right place.
 */
export default function AnnouncementsPage() {
  redirect("/messages");
}
