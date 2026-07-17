"use client";

import { ArrowRightIcon, BookOpenIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PanelLabel } from "@/components/shared/panel-label";
import { findCampaign } from "@/lib/dm/campaigns";
import type { StoryCampaign } from "@/lib/dm/db";
import { cn } from "@/lib/utils";

// Home-dashboard "resume" list. Story campaigns are the app's only
// cross-session content — coop combat is spun up and torn down within a
// sitting — so this surfaces a signed-in user's in-progress stories
// (waiting in a lobby or actively being played) with a direct link back
// in. Without it, the only way back to a story was the invite URL or the
// router push at create time.
//
// Renders nothing until it has at least one in-progress story, so it
// never flashes an empty panel for a new player.
export function ContinueAdventures() {
  const [stories, setStories] = useState<StoryCampaign[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/story");
        if (!res.ok) return;
        const data = (await res.json()) as StoryCampaign[];
        if (!cancelled) setStories(data);
      } catch (err) {
        console.error("continue-adventures fetch failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // In-progress only: a lobby still assembling, or an active run.
  const resumable = (stories ?? []).filter(
    (s) => s.status === "lobby" || s.status === "active",
  );
  if (resumable.length === 0) return null;

  return (
    <div className="relative flex flex-col gap-2 rounded-md border-2 border-foreground bg-card p-3 font-mono">
      <PanelLabel>Continue Your Adventure</PanelLabel>
      <ul className="flex flex-col gap-2 pt-1">
        {resumable.map((s) => {
          const template = findCampaign(s.campaign_template_id);
          const scene =
            template?.scenes.find((sc) => sc.id === s.current_scene_id) ?? null;
          const inLobby = s.status === "lobby";
          return (
            <li key={s.id}>
              <Link
                href={`/story/${s.id}`}
                className={cn(
                  "group flex items-center gap-3 rounded-md border border-zinc-300 bg-background px-3 py-2",
                  "transition-colors hover:border-foreground hover:bg-muted/40",
                )}
              >
                <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-bold uppercase tracking-widest">
                    {template?.title ?? "Story"}
                  </span>
                  <span className="truncate text-xs uppercase tracking-widest text-muted-foreground">
                    {s.mode === "coop" ? "Co-op" : "Solo"}
                    {" · "}
                    {inLobby
                      ? "In lobby"
                      : scene
                        ? `Scene · ${scene.title}`
                        : "In progress"}
                  </span>
                </div>
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors group-hover:text-foreground">
                  {inLobby ? "Enter" : "Resume"}
                  <ArrowRightIcon className="size-3.5" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
