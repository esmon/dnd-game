-- Persist the rolled turn order for each campaign so monster swings,
-- player turns, and the action route's pointer arithmetic all see the
-- same sequence. Set when status flips from waiting → active (start
-- route rolls d20 + DEX mod for every actor and stores the result
-- here). Older active/finished campaigns leave it null and fall back
-- to position-order round-robin in nextAliveSlot.
alter table campaigns
  add column if not exists initiative_order jsonb;
