"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useReducer, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUser } from "@/lib/auth/use-user";
import { findCampaign } from "@/lib/dm/campaigns";
import type { StoryCampaign, StoryMessage } from "@/lib/dm/db";
import { cn } from "@/lib/utils";

type Snapshot = {
  campaign: StoryCampaign;
  messages: StoryMessage[];
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: Snapshot }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

interface PageState {
  load: LoadState;
  input: string;
  submitting: boolean;
}

type PageAction =
  | { type: "SET_LOAD"; load: LoadState }
  | { type: "SET_INPUT"; input: string }
  | { type: "SUBMIT_BEGIN" }
  | { type: "SUBMIT_END" }
  | { type: "APPEND_MESSAGE"; message: StoryMessage };

function pageReducer(state: PageState, action: PageAction): PageState {
  switch (action.type) {
    case "SET_LOAD":
      return { ...state, load: action.load };
    case "SET_INPUT":
      return { ...state, input: action.input };
    case "SUBMIT_BEGIN":
      return { ...state, submitting: true };
    case "SUBMIT_END":
      return { ...state, submitting: false };
    case "APPEND_MESSAGE":
      if (state.load.kind !== "ready") return state;
      return {
        ...state,
        load: {
          ...state.load,
          data: {
            ...state.load.data,
            messages: [...state.load.data.messages, action.message],
          },
        },
      };
  }
}

const INITIAL: PageState = {
  load: { kind: "loading" },
  input: "",
  submitting: false,
};

export default function StoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: campaignId } = use(params);
  const router = useRouter();
  const { user, loading: authLoading } = useUser();
  const [state, dispatch] = useReducer(pageReducer, INITIAL);
  const { load, input, submitting } = state;

  // Sign-in gated. Anonymous browsers get sent to sign-in with a
  // `next` back to this page (same pattern coop uses).
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const next = encodeURIComponent(`/story/${campaignId}`);
      router.replace(`/auth/sign-in?next=${next}`);
    }
  }, [authLoading, user, campaignId, router]);

  // One-shot load. Future phases will swap to a realtime channel
  // for incoming DM messages.
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/story/${campaignId}`);
        if (cancelled) return;
        if (res.status === 404) {
          dispatch({ type: "SET_LOAD", load: { kind: "not-found" } });
          return;
        }
        if (!res.ok) {
          dispatch({
            type: "SET_LOAD",
            load: { kind: "error", message: `Failed to load (${res.status})` },
          });
          return;
        }
        const data = (await res.json()) as Snapshot;
        dispatch({ type: "SET_LOAD", load: { kind: "ready", data } });
      } catch (err) {
        if (cancelled) return;
        dispatch({
          type: "SET_LOAD",
          load: {
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, authLoading, user]);

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || submitting) return;
    dispatch({ type: "SUBMIT_BEGIN" });
    try {
      const res = await fetch(`/api/story/${campaignId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "player", content: trimmed }),
      });
      if (!res.ok) {
        console.error("post message failed", res.status);
        return;
      }
      const message = (await res.json()) as StoryMessage;
      dispatch({ type: "APPEND_MESSAGE", message });
      dispatch({ type: "SET_INPUT", input: "" });
    } catch (err) {
      console.error("post message threw", err);
    } finally {
      dispatch({ type: "SUBMIT_END" });
    }
  }, [campaignId, input, submitting]);

  if (authLoading || load.kind === "loading") {
    return <CenteredCard>Loading campaign…</CenteredCard>;
  }
  if (!user) {
    return <CenteredCard>Redirecting…</CenteredCard>;
  }
  if (load.kind === "not-found") {
    return (
      <CenteredCard>
        <p>Campaign not found.</p>
        <Link href="/" className="font-bold underline">
          Back to home
        </Link>
      </CenteredCard>
    );
  }
  if (load.kind === "error") {
    return (
      <CenteredCard>
        <p className="text-rose-600">Error: {load.message}</p>
        <Button onClick={() => router.refresh()}>Retry</Button>
      </CenteredCard>
    );
  }

  const { campaign, messages } = load.data;
  const template = findCampaign(campaign.campaign_template_id);

  return (
    <main className="relative flex min-h-screen items-start justify-center p-4 md:p-6">
      <Link
        href="/"
        aria-label="Back to home"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "absolute left-4 top-4 md:left-6 md:top-6",
        )}
      >
        <ArrowLeftIcon className="size-3.5 shrink-0" />
        <span className="hidden md:inline">Back to home</span>
      </Link>
      <div className="flex w-full max-w-2xl flex-col gap-4 pt-12 md:pt-0">
        <header className="flex flex-col gap-1 text-center font-mono">
          <h1 className="text-2xl font-bold uppercase tracking-widest md:text-3xl">
            {template?.title ?? "Story"}
          </h1>
          {template ? (
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {template.premise}
            </p>
          ) : null}
        </header>

        <div className="flex flex-col gap-3 rounded-md border-2 border-zinc-900 bg-card p-4 font-mono">
          <ScrollArea className="h-[55vh] pr-2">
            <ul className="flex flex-col gap-3">
              {messages.map((m) => (
                <MessageRow key={m.id} message={m} />
              ))}
              {messages.length === 0 ? (
                <li className="text-center text-sm">
                  The page is blank. Begin.
                </li>
              ) : null}
            </ul>
          </ScrollArea>
          <div className="flex flex-col gap-2">
            <textarea
              value={input}
              onChange={(e) =>
                dispatch({ type: "SET_INPUT", input: e.target.value })
              }
              placeholder="What does your character do?"
              rows={3}
              maxLength={4000}
              disabled={submitting || campaign.status !== "active"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
              className="min-h-20 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Cmd / Ctrl + Enter to send.
              </p>
              <Button
                onClick={send}
                disabled={
                  !input.trim() ||
                  submitting ||
                  campaign.status !== "active"
                }
              >
                {submitting ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function MessageRow({ message }: { message: StoryMessage }) {
  // Three visual styles. Narrative = DM voice, prose. Player =
  // chat-style bubble. System = small italic stage direction.
  // 'tool' rows aren't rendered for Phase 0 (don't exist yet);
  // when they do, they'll get their own block style.
  if (message.role === "narrative") {
    return (
      <li className="rounded-md border border-muted-foreground/20 bg-background p-3 text-sm leading-relaxed">
        {message.content}
      </li>
    );
  }
  if (message.role === "player") {
    return (
      <li className="ml-6 rounded-md bg-emerald-50 p-3 text-sm leading-relaxed dark:bg-emerald-950/40">
        <span className="block text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
          You
        </span>
        {message.content}
      </li>
    );
  }
  return (
    <li className="text-center text-xs italic text-muted-foreground">
      {message.content}
    </li>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-md border-2 border-zinc-900 bg-card p-6 text-center font-mono">
        {children}
      </div>
    </main>
  );
}
