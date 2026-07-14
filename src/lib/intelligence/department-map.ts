/**
 * Maps Prism Intelligence department strings → Prism Escalations category enum.
 * Keys are lowercase. Values must match the CHECK constraint:
 * Operations|HR|IT|SCM|QA|Finance|Maintenance|L&D
 * (Keep in sync with supabase/functions/audit-ingest DEPARTMENT_MAP.)
 */
export type TicketCategory =
  | 'Operations' | 'HR' | 'IT' | 'SCM' | 'QA'
  | 'Finance' | 'Maintenance' | 'L&D'

const DEPARTMENT_MAP: Record<string, TicketCategory> = {
  operations: 'Operations',
  ops: 'Operations',
  operational: 'Operations',
  store: 'Operations',
  floor: 'Operations',
  service: 'Operations',
  customer: 'Operations',
  cx: 'Operations',

  hr: 'HR',
  'human resources': 'HR',
  people: 'HR',
  talent: 'HR',
  hrbp: 'HR',
  payroll: 'HR',

  training: 'L&D',
  learning: 'L&D',
  lms: 'L&D',
  'l&d': 'L&D',
  lnd: 'L&D',

  it: 'IT',
  tech: 'IT',
  technology: 'IT',
  systems: 'IT',
  infra: 'IT',
  infrastructure: 'IT',

  scm: 'SCM',
  'supply chain': 'SCM',
  logistics: 'SCM',
  warehouse: 'SCM',
  inventory: 'SCM',
  procurement: 'SCM',
  purchase: 'SCM',

  qa: 'QA',
  quality: 'QA',
  audit: 'QA',
  compliance: 'QA',
  food: 'QA',
  hygiene: 'QA',
  safety: 'QA',
  health: 'QA',
  'food safety': 'QA',

  finance: 'Finance',
  accounts: 'Finance',
  billing: 'Finance',
  cash: 'Finance',

  maintenance: 'Maintenance',
  repair: 'Maintenance',
  repairs: 'Maintenance',
  facilities: 'Maintenance',
  facility: 'Maintenance',
  equipment: 'Maintenance',
  electrical: 'Maintenance',
  plumbing: 'Maintenance',
  hvac: 'Maintenance',
}

export function mapDepartment(raw: string | null | undefined): TicketCategory {
  if (!raw) return 'Operations'
  const key = raw.toLowerCase().trim()

  // Exact match
  if (key in DEPARTMENT_MAP) return DEPARTMENT_MAP[key]

  // Partial match — find the first key contained in the input
  for (const [mapKey, category] of Object.entries(DEPARTMENT_MAP)) {
    if (key.includes(mapKey)) return category
  }

  return 'Operations'
}
