import { supabaseAdmin } from "@/lib/supabase";

// Fire a broadcast on the campaign-scoped Realtime channel so any
// connected client refetches without waiting for the next poll tick.
// Best-effort and fire-and-forget — the page's slow-polling fallback
// catches anything we miss (websocket hiccups, channel auth quirks,
// etc.) so this never needs to block or error the route.
//
// Uses the broadcast endpoint via the admin (secret-key) client so we
// don't have to keep a subscription open per route invocation. On the
// client side, page.tsx subscribes to the same `campaign:<id>` topic
// with the publishable-key client.
export async function broadcastCampaignUpdate(
  campaignId: string,
): Promise<void> {
  try {
    const channel = supabaseAdmin.channel(`campaign:${campaignId}`);
    await channel.send({
      type: "broadcast",
      event: "updated",
      payload: { campaignId },
    });
    await supabaseAdmin.removeChannel(channel);
  } catch (err) {
    console.error(`broadcastCampaignUpdate ${campaignId} failed:`, err);
  }
}
