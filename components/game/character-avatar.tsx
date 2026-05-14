"use client";

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
        "font-mono font-bold uppercase tracking-widest text-zinc-800",
        dims.text,
      )}
    >
      {initialsFromName(name)}
    </span>
  );

  const boxClass = cn(
    "flex items-center justify-center overflow-hidden rounded-md",
    dims.box,
    className,
  );
  // Same radial wash MonsterCard uses, so the player's slot reads as
  // a portrait frame even when it's just initials.
  const boxStyle: React.CSSProperties = {
    background:
      "radial-gradient(circle, rgba(213,233,233,1) 0%, rgba(88,218,223,1) 100%)",
  };

  if (!onUpload) {
    return (
      <div className={boxClass} style={boxStyle}>
        {inner}
      </div>
    );
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
        style={boxStyle}
        aria-label={src ? "Change avatar" : "Add avatar"}
      >
        {inner}
        <span
          className={cn(
            "absolute inset-x-0 bottom-0 bg-zinc-900/70 py-0.5 text-center font-mono text-[9px] uppercase tracking-widest text-white",
            // Show on hover; always show while uploading so the user
            // knows the click registered.
            uploading
              ? "opacity-100"
              : "opacity-0 transition-opacity group-hover:opacity-100",
          )}
        >
          {uploading ? "Uploading…" : src ? "Change" : "Add"}
        </span>
      </button>
    </>
  );
}
