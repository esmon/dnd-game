import { NextRequest, NextResponse } from "next/server";

import { getRequestIdentity, isOwnedBy } from "@/lib/auth/server-identity";
import { supabase, supabaseAdmin } from "@/lib/supabase";
import type { Character } from "@/lib/db/schema";

const BUCKET = "character-avatars";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

type RouteContext = { params: Promise<{ id: string }> };

// Parse the storage object path back out of the public URL we wrote
// to characters.avatar_url. Used so an avatar swap can delete the
// previous file instead of leaving orphaned blobs in the bucket.
function pathFromPublicUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = `/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i < 0) return null;
  return url.slice(i + marker.length);
}

async function loadOwnedRow(
  id: string,
  request: NextRequest,
): Promise<
  | { kind: "ok"; row: Character }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
> {
  const identity = await getRequestIdentity(request);
  // Avatar upload is sign-in-gated. Anonymous players don't have a
  // Supabase character row to attach the file to — they see initials
  // until they sign in.
  if (!identity.userId) return { kind: "forbidden" };

  const { data, error } = await supabase
    .from("characters")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return { kind: "error", message: error.message };
  if (!data) return { kind: "not_found" };

  const row = data as Character;
  if (!isOwnedBy(row, identity)) return { kind: "forbidden" };
  return { kind: "ok", row };
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const owned = await loadOwnedRow(id, request);
  if (owned.kind === "error") {
    return NextResponse.json({ error: owned.message }, { status: 500 });
  }
  if (owned.kind === "not_found") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (owned.kind === "forbidden") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "unsupported type — use png / jpeg / webp" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (max ${MAX_BYTES / (1024 * 1024)} MB)` },
      { status: 400 },
    );
  }

  // Fresh uuid in the path so a swap produces a brand new URL — keeps
  // the browser from showing a cached old avatar after change.
  const path = `${id}/${crypto.randomUUID()}.${ext}`;
  const buf = await file.arrayBuffer();
  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: publicData } = supabaseAdmin.storage
    .from(BUCKET)
    .getPublicUrl(path);
  const avatar_url = publicData.publicUrl;

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("characters")
    .update({ avatar_url })
    .eq("id", id)
    .select()
    .single();

  if (updateError) {
    // Roll back the upload so we don't leave a file behind that the
    // row doesn't point to. Best-effort; if the cleanup itself fails
    // we'll have an orphan but the user sees a clean error.
    await supabaseAdmin.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Delete the previous avatar file (if any) once the new one is
  // safely persisted. Errors here are non-blocking — we already have
  // a working new avatar.
  const previousPath = pathFromPublicUrl(owned.row.avatar_url ?? null);
  if (previousPath && previousPath !== path) {
    void supabaseAdmin.storage.from(BUCKET).remove([previousPath]);
  }

  return NextResponse.json(updated as Character);
}

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const owned = await loadOwnedRow(id, request);
  if (owned.kind === "error") {
    return NextResponse.json({ error: owned.message }, { status: 500 });
  }
  if (owned.kind === "not_found") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (owned.kind === "forbidden") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const previousPath = pathFromPublicUrl(owned.row.avatar_url ?? null);
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("characters")
    .update({ avatar_url: null })
    .eq("id", id)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (previousPath) {
    void supabaseAdmin.storage.from(BUCKET).remove([previousPath]);
  }

  return NextResponse.json(updated as Character);
}
