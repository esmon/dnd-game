"use client";

import { CameraIcon } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

// 1- or 2-letter monogram from the character's name. "Brave Knight"
// → "BK"; "Aragorn" → "AR". Falls back to "?" so the avatar slot
// never renders blank.
function initialsFromName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

const SIZE_CLASSES = {
  // Matches the MonsterCard avatar slot so the player + monster cards
  // line up visually during a fight.
  lg: { box: "size-24", text: "text-3xl", img: 96 },
  sm: { box: "size-8", text: "text-xs", img: 32 },
} as const;

type Size = keyof typeof SIZE_CLASSES;

export function CharacterAvatar({
  src,
  name,
  size = "lg",
  className,
  onUpload,
}: {
  src: string | null;
  name: string;
  size?: Size;
  className?: string;
  // If provided, the avatar becomes a button: clicking opens the OS
  // file picker and calls back with the selected file. The caller is
  // responsible for the actual upload + URL refresh; this component
  // just renders the loading state while the promise resolves.
  onUpload?: (file: File) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const dims = SIZE_CLASSES[size];

  const inner = src ? (
    <Image
      src={src}
      alt={name}
      width={dims.img}
      height={dims.img}
      className="size-full object-cover"
      unoptimized
    />
  ) : (
    <span
      className={cn(
        "font-mono font-bold uppercase tracking-widest text-white",
        dims.text,
      )}
    >
      {initialsFromName(name)}
    </span>
  );

  // Matches the dark zinc-900 borders used throughout the panel
  // chrome, so the avatar reads as a contained slot (not a separate
  // brand color).
  const boxClass = cn(
    "flex items-center justify-center overflow-hidden rounded-md bg-zinc-900",
    dims.box,
    className,
  );

  if (!onUpload) {
    return <div className={boxClass}>{inner}</div>;
  }

  async function handleFile(file: File) {
    if (!onUpload) return;
    setUploading(true);
    try {
      await onUpload(file);
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          // Reset so re-selecting the same file fires onChange again.
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className={cn(
          boxClass,
          "group relative cursor-pointer transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60",
        )}
        aria-label={src ? "Change avatar" : "Add avatar"}
      >
        {inner}
        {/* Always-visible camera badge so the slot reads as
            "tap to upload." Previously a hover-only pill — that
            never showed up on touch devices and made the affordance
            invisible. While uploading, the badge swaps to a label so
            the user knows the click registered. */}
        <span
          className={cn(
            "absolute bottom-1 right-1 flex items-center justify-center rounded-full border border-zinc-900 bg-white text-zinc-900 shadow-sm transition-transform group-hover:scale-110",
            size === "lg" ? "size-7" : "size-4",
          )}
        >
          {uploading ? (
            <span className="text-[8px] font-bold uppercase tracking-widest">
              …
            </span>
          ) : (
            <CameraIcon className={size === "lg" ? "size-4" : "size-2.5"} />
          )}
        </span>
      </button>
    </>
  );
}
