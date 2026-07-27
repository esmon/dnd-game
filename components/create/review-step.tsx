"use client";

import { useEffect, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { CharacterAvatar } from "@/components/shared/character-avatar";
import { ALIGNMENTS, type Alignment } from "@/lib/dnd/alignments";
import type { Background } from "@/lib/dnd/backgrounds";
import type { DnDClass } from "@/lib/dnd/classes";
import type { Race } from "@/lib/dnd/races";
import type { AbilityScores } from "@/lib/db/schema";
import { ABILITY_KEYS, ABILITY_LABELS, abilityModifier } from "@/lib/dnd/derive";
import { weaponsByBaseId } from "@/lib/dnd/weapons";

type Props = {
  name: string;
  alignment: Alignment | null;
  race: Race;
  klass: DnDClass;
  background: Background;
  finalAbilities: AbilityScores;
  maxHp: number;
  // Signed-in only — anonymous users have no Supabase row to attach
  // the upload to, so we hide the avatar slot for them. Null = use
  // initials. Staged here on the Review step; the create page does
  // the actual upload after the character row exists.
  avatarFile: File | null;
  avatarUploadEnabled: boolean;
  onNameChange: (n: string) => void;
  onAlignmentChange: (a: Alignment) => void;
  onAvatarFileChange: (file: File | null) => void;
};

function formatMod(m: number): string {
  return m >= 0 ? `+${m}` : `${m}`;
}

export function ReviewStep({
  name,
  alignment,
  race,
  klass,
  background,
  finalAbilities,
  maxHp,
  avatarFile,
  avatarUploadEnabled,
  onNameChange,
  onAlignmentChange,
  onAvatarFileChange,
}: Props) {
  // Preview the staged file before it's uploaded. ObjectURL is
  // revoked on cleanup so we don't leak blob refs when the user
  // swaps files (or unmounts mid-creation).
  const previewUrl = useMemo(
    () => (avatarFile ? URL.createObjectURL(avatarFile) : null),
    [avatarFile],
  );
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="character-name">Character name</Label>
        <Input
          id="character-name"
          value={name}
          maxLength={32}
          placeholder="e.g. Tharivol"
          onChange={(e) => onNameChange(e.target.value)}
        />
      </div>

      {avatarUploadEnabled ? (
        <div className="flex flex-col gap-2">
          <Label>Avatar (optional)</Label>
          <div className="flex items-center gap-3">
            <CharacterAvatar src={previewUrl} name={name || "?"} size="lg" />
            <div className="flex flex-col gap-2">
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    onAvatarFileChange(f);
                    e.target.value = "";
                  }}
                />
                <span className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground">
                  {avatarFile ? "Choose different image" : "Choose image"}
                </span>
              </label>
              {avatarFile ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onAvatarFileChange(null)}
                >
                  Remove
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  PNG / JPG / WebP · max 2 MB
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label>Alignment</Label>
        <Select
          value={alignment ?? ""}
          onValueChange={(v: string | null) => {
            if (v) onAlignmentChange(v as Alignment);
          }}
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Pick alignment" />
          </SelectTrigger>
          <SelectContent>
            {ALIGNMENTS.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <div className="flex flex-col gap-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <span>Race:</span> <strong>{race.name}</strong>
          </div>
          <div>
            <span>Class:</span> <strong>{klass.name}</strong>
          </div>
          <div>
            <span>Background:</span>{" "}
            <strong>{background.name}</strong>
          </div>
          <div>
            <span>Max HP:</span> <strong>{maxHp}</strong>
          </div>
        </div>

        <div>
          <p className="mb-2">Ability scores</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {ABILITY_KEYS.map((key) => {
              const score = finalAbilities[key];
              return (
                <div key={key} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5">
                  <span>{ABILITY_LABELS[key]}</span>
                  <span>
                    <strong>{score}</strong>{" "}
                    <span>
                      ({formatMod(abilityModifier(score))})
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2">Starting weapons</p>
          <div className="flex flex-wrap gap-1.5">
            {klass.weapons.map((w) => {
              const def = weaponsByBaseId[w.baseId];
              if (!def) return null;
              return (
                <Badge key={w.baseId} variant="secondary">
                  {def.name} ({def.damage})
                </Badge>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
