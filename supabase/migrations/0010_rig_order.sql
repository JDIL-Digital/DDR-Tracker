-- 0010_rig_order.sql
-- Fixed fleet display order, DB-driven. Adds rigs.sort_order and seeds the known
-- fleet's order (creating rig rows if they don't exist yet, so the order is ready
-- even before a rig's first report). Any future/unknown rig defaults to 999 and
-- therefore sorts last; the app orders by (sort_order, name).
--
-- Order:  1 Discovery-1 · 2 Virtue-1 · 3 Jindal Star ·
--         4 Jindal Explorer · 5 Jindal Pioneer · 6 Jindal Supreme
--
-- Idempotent + atomic. Match is case-insensitive on name.

begin;

alter table public.rigs add column if not exists sort_order int not null default 999;

-- 1. Update existing rigs (case-insensitive name match).
update public.rigs r
set sort_order = v.ord
from (values
  ('Discovery-1', 1),
  ('Virtue-1', 2),
  ('Jindal Star', 3),
  ('Jindal Explorer', 4),
  ('Jindal Pioneer', 5),
  ('Jindal Supreme', 6)
) as v(name, ord)
where lower(r.name) = lower(v.name);

-- 2. Insert any known rig that doesn't exist yet, with its order.
insert into public.rigs (name, sort_order)
select v.name, v.ord
from (values
  ('Discovery-1', 1),
  ('Virtue-1', 2),
  ('Jindal Star', 3),
  ('Jindal Explorer', 4),
  ('Jindal Pioneer', 5),
  ('Jindal Supreme', 6)
) as v(name, ord)
where not exists (
  select 1 from public.rigs r where lower(r.name) = lower(v.name)
);

commit;
