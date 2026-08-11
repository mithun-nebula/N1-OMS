import { NextResponse } from "next/server";
import { getWorld } from "@/server/runtime";
import { providerModes } from "@/config/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const world = await getWorld();
  return NextResponse.json({
    status: "ok",
    service: "organization-a-spine",
    phase: "1-spine",
    operations: world.registry.list(),
    providers: providerModes(),
    time: new Date().toISOString(),
  });
}
