import { NextResponse } from "next/server";

import { fetchMonsterIndexList } from "@/lib/game/dnd5e";

export async function GET() {
  try {
    const list = await fetchMonsterIndexList();
    return NextResponse.json(list);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
