import { supabaseAdmin } from "@/lib/supabase";

// Fire a broadcast on the story-scoped Realtime channel so every
// connected member (players + DM) refetches the snapshot without
// waiting for the next poll tick. Best-effort and fire-and-forget —
// the story page keeps a slow-polling fallback so a dropped
// broadcast (websocket hiccup, channel auth quirk) still converges.
//
// Sent via the admin (secret-key) client so a route doesn't have to
// hold a subscription open. The client subscribes to the same
// `story:<id>` topic with the publishable-key client.
export async function broadcastStoryUpdate(
  campaignId: string,
): Promise<void> {
  try {
    const channel = supabaseAdmin.channel(`story:${campaignId}`);
    await channel.send({
      type: "broadcast",
      event: "updated",
      payload: { campaignId },
    });
    await supabaseAdmin.removeChannel(channel);
  } catch (err) {
    console.error(`broadcastStoryUpdate ${campaignId} failed:`, err);
  }
}
