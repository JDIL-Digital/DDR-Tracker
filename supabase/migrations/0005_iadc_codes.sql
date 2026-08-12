-- 0005_iadc_codes.sql
-- Replace the DRAFT activity codes (0002) with the OFFICIAL IADC code list, add
-- the contract "condition" classification, and add a benchmarks (norm) table.
-- Source: design/IADC_Code_Master_v1.xlsx  (tabs: Activity_Codes 75 rows, Benchmarks 13 rows).
--
-- ⚠️ DRAFT — pending Jindal team review.
--   The RODR / NODR / EBDR condition on each code, and the NPT flag derived from
--   it (is_npt = TRUE only where condition = 'EBDR'), are a FIRST-PASS mapping.
--   Every row is marked review_status = 'draft'. These are data values, not
--   schema — they can be edited later with a plain UPDATE (no rebuild/redeploy):
--     update code_master set condition='NODR', review_status='confirmed' where code='14A';
--
-- Idempotent + atomic: wrapped in a transaction; re-runnable.

begin;

-- a. Extend code_master ------------------------------------------------------
alter table code_master add column if not exists condition     text;
alter table code_master add column if not exists review_status text not null default 'draft';

-- condition may be null (future manual rows) but if set must be one of the three.
alter table code_master drop constraint if exists code_master_condition_chk;
alter table code_master add  constraint code_master_condition_chk
  check (condition is null or condition in ('RODR','NODR','EBDR'));

-- The old 3-value category (Productive/Non-Productive/Completion) does not map
-- onto the IADC scheme; 'condition' is now the authoritative classifier. We keep
-- the column but relax NOT NULL and leave it NULL for IADC rows rather than
-- invent a Productive/Non-Productive label (honest "unclassified").
alter table code_master alter column category drop not null;

-- b. Replace the draft codes with the 75 IADC codes -------------------------
-- FK guard: activities.code references code_master(code). Existing activities use
-- the OLD numeric codes, which are being removed. Null those references first so
-- the delete doesn't violate the FK — the activity ROWS (hours/depths/remarks)
-- are preserved; only their now-invalid code label is cleared. (Re-extract that
-- report later to re-tag it under the IADC codes.)
update activities set code = null
 where code is not null
   and code not in (
    '1A', '1B', '1C', '1D', '2A', '2B', '2C', '3A',
    '4A', '5A', '6A', '7A', '7B', '8A', '8B', '8C',
    '8D', '9A', '10A', '11A', '11B', '12A', '12B', '12C',
    '13A', '14A', '15A', '15B', '16A', '17A', '17B', '18A',
    '18B', '19A', '21A', '21B', '21C', '21D', '21E', '21F',
    '21G', '21H', '21I', '21J', '21K', '21L', '22A', '22B',
    '22C', '22D', '22E', '22F', '22G', '22H', '22I', '22J',
    '23A', '23B', '23C', '23D', '23E', '23F', '23G', '23H',
    '23I', '24A', '24B', '24C', '24D', '24E', '24F', '24G',
    '24H', '24I', '24J'
   );

delete from code_master;

-- (code, condition, is_npt, description); category intentionally left NULL; review_status defaults to 'draft'.
insert into code_master (code, condition, is_npt, description) values
  ('1A'   , 'NODR'  , false, 'Rig Move & Rig Building'),
  ('1B'   , 'NODR'  , false, 'Preparation for Rig Move, Rig/Jack Up-Down-Rig Build'),
  ('1C'   , 'NODR'  , false, 'Rig TPT / Sail / Tow / Position'),
  ('1D'   , 'NODR'  , false, 'Skidding / Dragging'),
  ('2A'   , 'RODR'  , false, 'Drilling Actual (Drilling, LDST/SDST/Drain Hole, etc.)'),
  ('2B'   , 'RODR'  , false, 'Piling'),
  ('2C'   , 'RODR'  , false, 'Section Mill / Window Cut Side Track (WO)'),
  ('3A'   , 'RODR'  , false, 'Reaming-Hole Enlarge / Under Reaming'),
  ('4A'   , 'RODR'  , false, 'Coring'),
  ('5A'   , 'RODR'  , false, 'C&C / Well Services - bulldoze, changeover, well killing, loss ctrl, sand/bottom cleaning'),
  ('6A'   , 'RODR'  , false, 'Tripping, M/U, B/U, L/D Str / BHA / Flex trip, trips w/ well compln, A/Lift, packer set'),
  ('7A'   , 'NODR'  , false, 'Lubricate Rig (Preventive Maintenance)'),
  ('7B'   , 'NODR'  , false, 'Safety / Fire Drills'),
  ('8A'   , 'EBDR'  , true , 'Drilling / Production Eqpt. Repairs'),
  ('8B'   , 'EBDR'  , true , 'Mechanical Repairs, Auto Repair'),
  ('8C'   , 'EBDR'  , true , 'Electrical Repairs'),
  ('8D'   , 'EBDR'  , true , 'Instrumentation Repairs'),
  ('9A'   , 'NODR'  , false, 'Shift-Cut-Change Off Drilling Line'),
  ('10A'  , 'RODR'  , false, 'Deviation Survey / TOTCO'),
  ('11A'  , 'NODR'  , false, 'Wireline logging (CBL-VDL/USIT/CIT), perf ops, tubing punch/cut, set BP/CR/PP, dummy run, VSP'),
  ('11B'  , 'NODR'  , false, 'PLT (Production Logging)'),
  ('12A'  , 'RODR'  , false, 'Casing / Liner Lowering'),
  ('12B'  , 'RODR'  , false, 'Circulation Prior to Cementation & Cementation'),
  ('12C'  , 'RODR'  , false, 'Drill Cement / F/C / F/S'),
  ('13A'  , 'NODR'  , false, 'W.O.C (Wait on Cement)'),
  ('14A'  , 'NODR'  , false, 'N/Up-N/Down WH / BOP / X-Mas Tree'),
  ('15A'  , 'NODR'  , false, 'Test WH / BOP / X-Mas Tree'),
  ('15B'  , 'RODR'  , false, 'SIT / LOT / PIT / Test CSG / HT'),
  ('16A'  , 'RODR'  , false, 'Drill Stem Test (DST)'),
  ('17A'  , 'RODR'  , false, 'Plug Back — Zone Isolation'),
  ('17B'  , 'NODR'  , false, 'Plug Back / CSG Retrieval / ABDN (Abandonment)'),
  ('18A'  , 'RODR'  , false, 'Squeeze Cement (for Cmt Bond repair)'),
  ('18B'  , 'RODR'  , false, 'Gel / Polymer Squeeze / Injectivity Testing / WO Shut-Off Ops'),
  ('19A'  , 'RODR'  , false, 'Fishing'),
  ('21A'  , 'NODR'  , false, 'Shutdown (In Cycle) — Waiting on Weather'),
  ('21B'  , 'NODR'  , false, 'Waiting for Logistics'),
  ('21C'  , 'NODR'  , false, 'Waiting for Civil Work / Sea Bed / Soil Survey'),
  ('21D'  , 'NODR'  , false, 'Wait for Decision / Instruction'),
  ('21E'  , 'NODR'  , false, 'Wait for Material / Men / Mud / Chemical'),
  ('21F'  , 'NODR'  , false, 'Waiting for Daylight'),
  ('21G'  , 'NODR'  , false, 'Waiting for Logging'),
  ('21H'  , 'NODR'  , false, 'Waiting for Cementing'),
  ('21I'  , 'NODR'  , false, 'Waiting for WS'),
  ('21J'  , 'NODR'  , false, 'Waiting for Artificial Lift'),
  ('21K'  , 'NODR'  , false, 'Waiting for Reservoir / BHS'),
  ('21L'  , 'NODR'  , false, 'Waiting for Other Services (MWD, Wire Line Job, etc.)'),
  ('22A'  , 'NODR'  , false, 'Complications — Kick / Blow Out'),
  ('22B'  , 'NODR'  , false, 'Mud Loss / Loss Control'),
  ('22C'  , 'RODR'  , false, 'H/Up - T/P - Back Ream / Ream'),
  ('22D'  , 'RODR'  , false, 'Side Tracking'),
  ('22E'  , 'NODR'  , false, 'Stuck Up'),
  ('22F'  , 'EBDR'  , true , 'String Failure'),
  ('22G'  , 'EBDR'  , true , 'Down Hole Tool / Bit Failure'),
  ('22H'  , 'RODR'  , false, 'Cement Bond Improvement'),
  ('22I'  , 'EBDR'  , true , 'Casing Repairs'),
  ('22J'  , 'NODR'  , false, 'Complications — Logging'),
  ('23A'  , 'RODR'  , false, 'Prodn Testing — Activation, N2/Air Comp, Flow study, Sampling, BHS, WUO'),
  ('23B'  , 'NODR'  , false, 'Well Stimulation, Coil Tubing operations, etc.'),
  ('23C'  , 'RODR'  , false, 'Release / Retrieve Packer / String'),
  ('23D'  , 'RODR'  , false, 'Milling of CR / BP / PP / Cement Drilling'),
  ('23E'  , 'NODR'  , false, 'Prod Wireline Ops (SSSV, GLV, SIV/B Plug/S-Plug related)'),
  ('23F'  , 'RODR'  , false, 'Artificial Lift (Jet/ESP/SRP/GL) Trial runs / Surface jobs'),
  ('23G'  , 'RODR'  , false, 'Gravel Pack / Sand Control'),
  ('23H'  , 'RODR'  , false, 'Fracturing'),
  ('23I'  , 'RODR'  , false, 'Planned Fishing'),
  ('24A'  , 'NODR'  , false, 'Out of Cycle — Waiting on Weather / Natural Calamity / Environment'),
  ('24B'  , 'NODR'  , false, 'Waiting on Location'),
  ('24C'  , 'NODR'  , false, 'Waiting for Logistics'),
  ('24D'  , 'NODR'  , false, 'Waiting for Ready Site'),
  ('24E'  , 'NODR'  , false, 'Local Agitation / Barricade'),
  ('24F'  , 'EBDR'  , true , 'Capital Repairs / Refurb at Site or CWS'),
  ('24G'  , 'NODR'  , false, 'R/M Inter Company O/Cycle'),
  ('24H'  , 'NODR'  , false, 'Third Party Inspection / NDT'),
  ('24I'  , 'NODR'  , false, 'Weekly off, Closed days, Shift not Planned'),
  ('24J'  , 'NODR'  , false, 'Any Other Waiting With Approval of CA');

-- c. Benchmarks (contract norms) --------------------------------------------
create table if not exists benchmarks (
  id             uuid primary key default gen_random_uuid(),
  iadc_code      text references code_master(code),
  operation_name text not null,
  start_desc     text,
  close_desc     text,
  norm_value     numeric,
  norm_unit      text check (norm_unit in ('hr','stand/hr'))
);

insert into benchmarks (iadc_code, operation_name, start_desc, close_desc, norm_value, norm_unit) values
  ('1D', 'Skidding Time In & Out',
     'Commencement of cantilever skidding / substructure operation',
     'Skid out: rig reaches well centre / rig move: cantilever fully stowed',
     1.5, 'hr'),
  ('14A', 'Wellhead fitting & pressure test — after 20" / 18-5/8" / 16" casing',
     'Preparation for wellhead stack fitting incl welding of bowl & accessories',
     'Successful pressure testing of wellhead',
     4, 'hr'),
  ('14A', 'Wellhead fitting & pressure test — 13-3/8" / 13-5/8" casing',
     'Preparation for wellhead stack fitting & accessories',
     'Successful pressure testing of wellhead',
     3, 'hr'),
  ('14A', 'Wellhead fitting & pressure test — after 9-5/8" casing',
     'Preparation for wellhead stack fitting & accessories',
     'Successful pressure testing of wellhead',
     3, 'hr'),
  ('14A', 'N/up or N/down BOP Stack (no wellhead) — 21¼" & 13-5/8" & other',
     'N/up riser/spacer spool/cross-over on wellhead; prep for N/down flow line, trip tank hose',
     'Rig up/down BOP stack handling equipment',
     4, 'hr'),
  ('15A', 'Function & pressure test of BOP stack w/ choke & kill manifold',
     'Make up BOP stack test assembly (test plug or cup tester)',
     'Lay down test assembly',
     2.5, 'hr'),
  ('15A', 'Op activity after WOC till func & pressure test of 21¼" BOP (after 20" casing)',
     'Operations after completion of WOC',
     'Successful pressure test of BOP stack, choke manifold, HCR, FOSV, IBOP; L/down test assy; ready for R/I',
     14, 'hr'),
  ('15A', 'Op activity after WOC till func & pressure test of 13-5/8" BOP (after 13-3/8" casing)',
     'Operations after completion of WOC',
     'Successful pressure test of BOP stack & L/down test assy; ready for R/I',
     13, 'hr'),
  ('15A', 'Op activity after WOC till func & pressure test of 13-5/8" BOP (after 9-5/8" casing)',
     'Operations after completion of WOC',
     'Successful pressure test of BOP stack & L/down test assy; ready for R/I',
     12, 'hr'),
  ('9A', 'Casing Line Slip',
     'After securing well safe & start of arrangements for parking TDS',
     'Release hanging block from T/block, set twin stop, ready for next op',
     1.5, 'hr'),
  ('9A', 'Casing Line Slip and Cut',
     'After securing well safe & start of arrangements for parking TDS',
     'Release hanging block from T/block, set twin stop, ready for next op',
     2.5, 'hr'),
  ('6A', 'Cased-hole Tripping IN',
     'R/I of drill pipe/tubing (all sizes) after R/I BHA',
     'R/I up to last casing shoe',
     22, 'stand/hr'),
  ('6A', 'Cased-hole Tripping OUT',
     'P/o of DP (all sizes) from casing shoe',
     'P/o up to BHA',
     22, 'stand/hr');

-- RLS parity with 0003: benchmarks is read-only to the front-end (anon) key;
-- writes stay on the server-side secret key (which bypasses RLS).
alter table benchmarks enable row level security;
grant select on benchmarks to anon, authenticated;
drop policy if exists "public read benchmarks" on benchmarks;
create policy "public read benchmarks" on benchmarks
  for select to anon, authenticated using (true);

commit;
