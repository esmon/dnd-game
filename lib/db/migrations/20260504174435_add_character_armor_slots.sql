-- 5e armor + shield slots on the character row. JSONB so the Armor
-- shape can evolve without follow-up migrations. Default null = the
-- character is unarmored, which the AC formula handles as the
-- existing "10 + DEX mod" / Unarmored Defense fallback.
alter table characters
  add column if not exists equipped_armor jsonb,
  add column if not exists equipped_shield jsonb;
