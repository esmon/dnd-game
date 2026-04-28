import { NextRequest, NextResponse } from "next/server";

import { fetchMonsterIndexList } from "@/lib/game/dnd5e";

function parseLevel(raw: string | null): number {
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 20) return 20;
  return Math.floor(n);
}

export async function GET(request: NextRequest) {
  const level = parseLevel(request.nextUrl.searchParams.get("level"));
  try {
    const list = await fetchMonsterIndexList(level);
    return NextResponse.json(list);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
