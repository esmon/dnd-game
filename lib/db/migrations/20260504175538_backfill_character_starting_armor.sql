-- One-shot backfill: every character that pre-dates the armor
-- catalog has equipped_armor / equipped_shield as null. Stamp the
-- piece their class would have been issued at creation, matching
-- the startingArmor / startingShield fields on lib/dnd/classes.ts.
--
-- Gated on `is null` so this is idempotent — re-running won't
-- overwrite armor a player swapped after their initial roll.
-- Skips Barbarian / Monk / Sorcerer / Wizard (no starting armor in
-- the kit). Class match is case-insensitive against the `class`
-- text column.
--
-- Armor JSON shape mirrors the runtime Armor type:
--   { id, baseId, name, category, acBase, [dexCap], [stealthDisadvantage], [strRequirement] }
-- gen_random_uuid() is from pgcrypto (default-enabled on Supabase).

-- Light: AC base + DEX, no cap.
update characters set equipped_armor = jsonb_build_object(
  'id', gen_random_uuid()::text,
  'baseId', 'leather',
  'name', 'Leather Armor',
  'category', 'light',
  'acBase', 11
) where equipped_armor is null and lower(class) in ('bard', 'druid', 'rogue', 'warlock');

update characters set equipped_armor = jsonb_build_object(
  'id', gen_random_uuid()::text,
  'baseId', 'studded-leather',
  'name', 'Studded Leather',
  'category', 'light',
  'acBase', 12
) where equipped_armor is null and lower(class) = 'ranger';

-- Medium: AC base + min(DEX, 2).
update characters set equipped_armor = jsonb_build_object(
  'id', gen_random_uuid()::text,
  'baseId', 'chain-shirt',
  'name', 'Chain Shirt',
  'category', 'medium',
  'acBase', 13,
  'dexCap', 2
) where equipped_armor is null and lower(class) = 'cleric';

-- Heavy: AC base only, DEX excluded.
update characters set equipped_armor = jsonb_build_object(
  'id', gen_random_uuid()::text,
  'baseId', 'chain-mail',
  'name', 'Chain Mail',
  'category', 'heavy',
  'acBase', 16,
  'dexCap', 0,
  'strRequirement', 13,
  'stealthDisadvantage', true
) where equipped_armor is null and lower(class) in ('fighter', 'paladin');

-- Shields: cleric + druid + fighter + paladin start with one. Every
-- shield row gets its own uuid so two characters never share an
-- armor row id.
update characters set equipped_shield = jsonb_build_object(
  'id', gen_random_uuid()::text,
  'baseId', 'shield',
  'name', 'Shield',
  'category', 'shield',
  'acBase', 0
) where equipped_shield is null and lower(class) in ('cleric', 'druid', 'fighter', 'paladin');
