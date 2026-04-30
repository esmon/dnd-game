import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getRequestIdentity } from "@/lib/auth/server-identity";
import { supabaseAdmin } from "@/lib/supabase";
import type { Campaign, CampaignPlayer } from "./types";

// Single auth + load helper for every signed-in coop endpoint that
// operates on an existing campaign. Coop routes use the service-role
// client (RLS recursion + schema-cache flakiness made user-scoped
// queries unreliable here), so this helper is the only line of
// defense — every member-gated route MUST go through it.
//
// Returns either the loaded context (campaign row, all players, the
// caller's player row, role flags) or a NextResponse the route can
// return verbatim. The error responses match the shapes the previous
// copy-pasted checks produced (401 unsigned, 404 not found, 403
// forbidden) so callers' error UI doesn't shift.

export interface CampaignContext {
  userId: string;
  campaign: Campaign;
  players: CampaignPlayer[];
  // The caller's row, or null if the caller is the creator and
  // somehow has no player row (shouldn't happen — campaign create
  // inserts player 0 — but defensive).
  myPlayer: CampaignPlayer | null;
  isCreator: boolean;
}

export type CampaignAuthResult =
  | { ok: true; ctx: CampaignContext }
  | { ok: false; response: NextResponse };

export type RequiredRole = "member" | "creator";

export async function authorizeCampaign(
  request: NextRequest,
  campaignId: string,
  requireRole: RequiredRole = "member",
): Promise<CampaignAuthResult> {
  const { userId } = await getRequestIdentity(request);
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "must be signed in" },
        { status: 401 },
      ),
    };
  }

  const campaignRes = await supabaseAdmin
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignRes.error) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: campaignRes.error.message },
        { status: 500 },
      ),
    };
  }
  if (!campaignRes.data) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "campaign not found" },
        { status: 404 },
      ),
    };
  }
  const campaign = campaignRes.data as Campaign;

  const playersRes = await supabaseAdmin
    .from("campaign_players")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("position", { ascending: true });
  if (playersRes.error) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: playersRes.error.message },
        { status: 500 },
      ),
    };
  }
  const players = (playersRes.data ?? []) as CampaignPlayer[];

  const isCreator = campaign.created_by === userId;
  const myPlayer = players.find((p) => p.user_id === userId) ?? null;
  const isMember = isCreator || myPlayer !== null;

  if (!isMember) {
    return {
      ok: false,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  if (requireRole === "creator" && !isCreator) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "only the creator can do this" },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    ctx: { userId, campaign, players, myPlayer, isCreator },
  };
}
