-- 0002_seed_codes.sql
-- DRAFT code list — to be confirmed with ops team.
--
-- Categories: 'Productive' | 'Non-Productive' | 'Completion'
-- is_npt = true flags Non-Productive Time (waiting / complication / repair / fishing).
-- Codes 1..26 are the daily-operations list; C1..C6 are completion-phase codes.

insert into code_master (code, description, category, is_npt) values
  -- Productive operations (1..17) ------------------------------------------
  ('1',  'Drilling',                            'Productive',      false),
  ('2',  'Tripping (in/out of hole)',           'Productive',      false),
  ('3',  'Running casing',                      'Productive',      false),
  ('4',  'Cementing',                           'Productive',      false),
  ('5',  'Circulating / conditioning mud',      'Productive',      false),
  ('6',  'Rig up',                              'Productive',      false),
  ('7',  'Rig down',                            'Productive',      false),
  ('8',  'Nipple up / test BOP',                'Productive',      false),
  ('9',  'Coring',                              'Productive',      false),
  ('10', 'Wireline logging',                    'Productive',      false),
  ('11', 'Reaming / hole opening',              'Productive',      false),
  ('12', 'Directional drilling / surveying',    'Productive',      false),
  ('13', 'Make up / break out BHA',             'Productive',      false),
  ('14', 'Wellhead installation',               'Productive',      false),
  ('15', 'Pressure testing',                    'Productive',      false),
  ('16', 'Mud logging / formation evaluation',  'Productive',      false),
  ('17', 'Flow check / well monitoring',        'Productive',      false),

  -- Non-Productive Time (18..26) -------------------------------------------
  ('18', 'Waiting on weather',                  'Non-Productive',  true),
  ('19', 'Waiting on cement (WOC)',             'Non-Productive',  true),
  ('20', 'Waiting on material / logistics',     'Non-Productive',  true),
  ('21', 'Waiting on decision / instructions',  'Non-Productive',  true),
  ('22', 'Rig equipment repair / breakdown',    'Non-Productive',  true),
  ('23', 'Complication - stuck pipe',           'Non-Productive',  true),
  ('24', 'Complication - lost circulation',     'Non-Productive',  true),
  ('25', 'Complication - well control / kick',  'Non-Productive',  true),
  ('26', 'Fishing operations',                  'Non-Productive',  true),

  -- Completion phase (C1..C6) ----------------------------------------------
  ('C1', 'Perforation',                         'Completion',      false),
  ('C2', 'Running completion string / tubing',  'Completion',      false),
  ('C3', 'Installing production packer',        'Completion',      false),
  ('C4', 'Well testing / DST',                  'Completion',      false),
  ('C5', 'X-mas tree / wellhead completion',    'Completion',      false),
  ('C6', 'Well handover / suspension',          'Completion',      false)
on conflict (code) do nothing;
