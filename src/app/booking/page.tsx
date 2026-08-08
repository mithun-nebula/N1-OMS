import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { Shell } from "../shell";
import { BookingClient } from "./booking-client";

export default async function BookingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { deps } = getWorld();

  const rooms = deps.graph.find("room", () => true).map((n) => ({
    id: n.id,
    name: (n.data as { name?: string }).name ?? n.id,
    capacity: (n.data as { capacity?: number }).capacity ?? 0,
    equipment: (n.data as { equipment?: string[] }).equipment ?? [],
  }));

  const bookings = deps.graph.find("booking", () => true).map((n) => ({
    id: n.id,
    roomId: (n.data as { roomId?: string }).roomId ?? "",
    title: (n.data as { title?: string }).title ?? "",
    by: (n.data as { by?: string }).by ?? "",
    from: (n.data as { from?: string }).from ?? "",
    to: (n.data as { to?: string }).to ?? "",
  }));

  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? id;

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Room booking</h1>
      </header>
      <BookingClient rooms={rooms} bookings={bookings.map((b) => ({ ...b, roomName: roomName(b.roomId) }))} />
    </Shell>
  );
}
