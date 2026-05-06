-- Per-character battle counters (StatsBar wins / losses / run aways).
-- Lived only in the reducer's local state until now; persisting them
-- so the bar survives reloads and lights up across devices for
-- signed-in players. Defaults at 0 so legacy rows continue to read
-- as fresh counters.
alter table characters
  add column if not exists wins integer not null default 0,
  add column if not exists losses integer not null default 0,
  add column if not exists runaways integer not null default 0;
