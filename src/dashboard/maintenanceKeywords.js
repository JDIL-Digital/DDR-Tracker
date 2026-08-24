// Two-tier keyword highlights for DMR maintenance activities.
//
// Matching is CLIENT-SIDE, CASE-INSENSITIVE, PARTIAL (keyword appears anywhere
// in the activity text). CRITICAL wins over NOTABLE; no match = routine (no flag).
//
// Structured for easy editing now and a later move to a DB / editable admin UI:
// each tier is a flat, ordered keyword list (NOTABLE is authored in labelled
// groups purely for readability, then flattened for matching). To make these
// DB-driven later, load the same shapes (CRITICAL_KEYWORDS / NOTABLE_KEYWORDS)
// from a table and keep matchKeywords() unchanged.

// --- CRITICAL (red) ---------------------------------------------------------
export const CRITICAL_KEYWORDS = [
  'Equipment down',
  'Breakdown',
  'Non-operational',
  'Critical failure',
  'Redundant unit unavailable',
  'Downtime logged',
  'Derated operation',
  'Safety risk identified',
  'Operational restriction',
  'Emergency repair',
  'Delay in operations',
  'Awaiting OEM support',
  'Awaiting spares',
  'Urgent requirement',
  'Spares shortage',
  'Part unavailable',
  'Critical spare consumed',
  'Wrong material received',
  'Minimum stock level reached',
  'Alarms',
  'trips',
  'Part failure',
  'Out of service',
  'OOS',
]

// --- NOTABLE (amber) — authored in groups, flattened for matching ------------
export const NOTABLE_GROUPS = {
  'Critical equipment': [
    'Drawworks', 'Top Drive', 'TDS', 'Iron Roughneck', 'Mud Pumps', 'Shale Shakers',
    'Centrifuges', 'Mud Agitators', 'Rotary Table', 'Pipe Handling', 'Cranes', 'Pedestal Crane',
    'BOP Control Unit', 'HPU', 'Jacking System', 'SCR', 'VFD', 'Generator Engines',
    'Air Compressors', 'Choke Manifold', 'Standpipe Manifold', 'Firewater Pump', 'Ballast Pumps',
    'HVAC', 'RO Plant', 'Water Maker', 'Sewage Treatment',
  ],
  'Maintenance actions': [
    'Inspection performed', 'PM completed', 'Condition monitoring', 'Vibration abnormal',
    'Oil analysis', 'Temperature high', 'Pressure low', 'Leak observed', 'Alignment check',
    'Replacement required', 'Rectified', 'Calibrated', 'Overhaul', 'TOH', 'MOH',
    'Bearing replaced', 'Seal replacement', 'Filter change', 'Motor winding', 'Troubleshooting',
    'Testing and commissioning', 'Lubrication', 'Coupling alignment', 'Damage observed',
    'Wear detected', 'Calibration due', 'Restored to service',
  ],
  'Engine / power': [
    'Engine load', 'Fuel consumption increase', 'Lube oil consumption', 'Turbocharger',
    'Injector calibration', 'Exhaust temperature high', 'Jacket water temperature',
    'Cooling system', 'Bearing clearance', 'Cylinder balancing',
  ],
  'Hoisting / well control': [
    'Fast line', 'Dead line', 'Brake capacity', 'RLA pressure', 'Hookload', 'Crown block',
    'Traveling block', 'BOP function test', 'Accumulator pressure', 'Control panel', 'Valve leak',
  ],
  'Spares (neutral)': [
    'Material Requisition', 'MR raised', 'IRR submitted', 'Spares received', 'Long lead item',
    'Stock verification', 'Fast-moving consumable', 'Standby unit online',
  ],
}
export const NOTABLE_KEYWORDS = Object.values(NOTABLE_GROUPS).flat()

// Match one activity's text. Returns { tier: 'critical'|'notable'|null, keyword }.
// CRITICAL is checked first so it wins ties.
export function matchKeywords(text) {
  const t = String(text || '').toLowerCase()
  for (const kw of CRITICAL_KEYWORDS) if (t.includes(kw.toLowerCase())) return { tier: 'critical', keyword: kw }
  for (const kw of NOTABLE_KEYWORDS) if (t.includes(kw.toLowerCase())) return { tier: 'notable', keyword: kw }
  return { tier: null, keyword: null }
}
