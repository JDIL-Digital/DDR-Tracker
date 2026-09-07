-- 0022_iadc_codes_authoritative.sql
-- Align code_master with the AUTHORITATIVE IADC_Code_Master_v1.xlsx (Activity_Codes).
-- Values generated directly from the file (not hand-typed) to avoid transcription
-- error. Authoritative condition totals: RODR 27, NODR 37, EBDR 10, MDR 1 = 75.
--
-- 1. SCHEMA: extend the condition CHECK constraint to allow 'MDR' (was RODR/NODR/EBDR).
-- 2. DATA: set each code's condition to the file value; mark all 75 review_status='confirmed'.
-- 3. is_npt: kept as is_npt = (condition = 'EBDR') ONLY. MDR is_npt stays FALSE.
--    ⚠️ PENDING TEAM CONFIRMATION: whether MDR (Move/Demob... contract-specific)
--    should count as NPT. If confirmed, a follow-up migration sets
--    is_npt = (condition in ('EBDR','MDR')). Do NOT assume it here.
--
-- Idempotent + atomic (single transaction). ⚠️ Confirm the Supabase project is
-- "DDR-Tracker" (edrmbzcqffatjnommfcc) before running. Run after 0021.

begin;

-- 1. Allow MDR in the condition constraint --------------------------------------
alter table code_master drop constraint if exists code_master_condition_chk;
alter table code_master add  constraint code_master_condition_chk
  check (condition is null or condition in ('RODR','NODR','EBDR','MDR'));

-- 2. Set authoritative condition per code (values FROM the file) + confirm -------
update code_master c
   set condition     = v.cond,
       review_status = 'confirmed'
  from (values
    ('1A', 'NODR'),
    ('1B', 'NODR'),
    ('1C', 'MDR'),
    ('1D', 'NODR'),
    ('2A', 'RODR'),
    ('2B', 'RODR'),
    ('2C', 'RODR'),
    ('3A', 'RODR'),
    ('4A', 'RODR'),
    ('5A', 'RODR'),
    ('6A', 'RODR'),
    ('7A', 'EBDR'),
    ('7B', 'EBDR'),
    ('8A', 'EBDR'),
    ('8B', 'EBDR'),
    ('8C', 'EBDR'),
    ('8D', 'EBDR'),
    ('9A', 'NODR'),
    ('10A', 'RODR'),
    ('11A', 'NODR'),
    ('11B', 'NODR'),
    ('12A', 'RODR'),
    ('12B', 'RODR'),
    ('12C', 'RODR'),
    ('13A', 'NODR'),
    ('14A', 'NODR'),
    ('15A', 'NODR'),
    ('15B', 'RODR'),
    ('16A', 'RODR'),
    ('17A', 'RODR'),
    ('17B', 'NODR'),
    ('18A', 'RODR'),
    ('18B', 'RODR'),
    ('19A', 'RODR'),
    ('21A', 'NODR'),
    ('21B', 'NODR'),
    ('21C', 'NODR'),
    ('21D', 'NODR'),
    ('21E', 'NODR'),
    ('21F', 'NODR'),
    ('21G', 'NODR'),
    ('21H', 'NODR'),
    ('21I', 'NODR'),
    ('21J', 'NODR'),
    ('21K', 'NODR'),
    ('21L', 'NODR'),
    ('22A', 'NODR'),
    ('22B', 'NODR'),
    ('22C', 'RODR'),
    ('22D', 'RODR'),
    ('22E', 'NODR'),
    ('22F', 'EBDR'),
    ('22G', 'EBDR'),
    ('22H', 'RODR'),
    ('22I', 'EBDR'),
    ('22J', 'NODR'),
    ('23A', 'RODR'),
    ('23B', 'NODR'),
    ('23C', 'RODR'),
    ('23D', 'RODR'),
    ('23E', 'NODR'),
    ('23F', 'RODR'),
    ('23G', 'RODR'),
    ('23H', 'RODR'),
    ('23I', 'RODR'),
    ('24A', 'NODR'),
    ('24B', 'NODR'),
    ('24C', 'NODR'),
    ('24D', 'NODR'),
    ('24E', 'NODR'),
    ('24F', 'EBDR'),
    ('24G', 'NODR'),
    ('24H', 'NODR'),
    ('24I', 'NODR'),
    ('24J', 'NODR')
  ) as v(code, cond)
 where c.code = v.code;

-- 3. Recompute is_npt from the (updated) condition — EBDR only for now ----------
--    (MDR deliberately NOT included pending team confirmation — see header.)
update code_master set is_npt = (condition = 'EBDR');

-- Safety asserts: totals must match the authoritative file, else roll back.
do $$
declare r int; n int; e int; m int; unconf int;
begin
  select count(*) into r from code_master where condition='RODR';
  select count(*) into n from code_master where condition='NODR';
  select count(*) into e from code_master where condition='EBDR';
  select count(*) into m from code_master where condition='MDR';
  select count(*) into unconf from code_master where review_status <> 'confirmed';
  if r<>27 or n<>37 or e<>10 or m<>1 then
    raise exception 'IADC condition totals mismatch: RODR=% NODR=% EBDR=% MDR=% (expected 27/37/10/1)', r,n,e,m;
  end if;
  if unconf<>0 then raise exception '% codes still not confirmed', unconf; end if;
end $$;

commit;
