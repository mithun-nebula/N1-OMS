import { NextResponse } from "next/server";
import { getNews } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ items: getNews() });
}
