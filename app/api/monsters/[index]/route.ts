import { NextResponse } from "next/server";

import { fetchMonster } from "@/lib/game/dnd5e";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ index: string }> },
) {
  const { index } = await params;
  try {
    const monster = await fetchMonster(index);
    return NextResponse.json(monster);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
