import { NextResponse } from "next/server";
import { getWorld } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const world = getWorld();
  return NextResponse.json({
    status: "ok",
    service: "organization-a-spine",
    phase: "1-spine",
    operations: world.registry.list(),
    time: new Date().toISOString(),
  });
}
