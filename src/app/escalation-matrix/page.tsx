'use client'

import { useMemo, useRef, useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase/client'
import { useCachedQuery } from '@/lib/use-cached-query'
import { useAuthStore } from '@/store/auth.store'
import { parseCsv, downloadCsv } from '@/lib/csv'
import {
  CATEGORY_LIST, SEVERITY_OPTIONS, ESCALATION_DELAY_PRESETS, formatEscalationDelay,
} from '@/lib/ticket-utils'
import type { EscalationPolicy, Store } from '@/lib/supabase/database.types'
import {
  GitBranch, Plus, Trash2, Globe2, MapPin, Building2, AlertCircle, Clock, Users, Check, Search, ShieldAlert,
  Upload, Download, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle,
} from 'lucide-react'

/** A notifiable person — either a dashboard user (`profiles`) or a roster
 *  employee synced daily from Prism Platform (`employee_roster`, no login). */
type Person = {
  id: string
  name: string
  email: string | null
  department: string | null
  role: string | null
  source: 'profile' | 'roster'
}
type StoreOption = Pick<Store, 'id' | 'store_name' | 'store_code' | 'region'>
type PolicyRow = EscalationPolicy & { people: Person[] }

const LEVELS = [1, 2, 3, 4, 5, 6]
const PEOPLE_PREVIEW_LIMIT = 60

/** Lowest level (1..6) not yet used for this exact department/store-or-region/severity scope. */
function nextLevelFor(rows: PolicyRow[], department: string, region: string, storeId: string, severity: string): number {
  const used = rows
    .filter((r) =>
      r.department === department
      && (r.store_id ?? '') === storeId
      && (storeId || (r.region ?? '') === region)
      && (r.severity ?? '') === severity)
    .map((r) => r.level)
  return LEVELS.find((l) => !used.includes(l)) ?? 1
}

/** `${source}:${id}` selection key — ids can theoretically collide across the two tables. */
const keyOf = (p: Person) => `${p.source}:${p.id}`

export default function EscalationMatrixPage() {
  const { profile } = useAuthStore()
  const canEdit = profile?.role === 'super_admin' || profile?.role === 'leadership'

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    department: CATEGORY_LIST[0],
    region: '',
    store_id: '',
    severity: '',
    level: 1,
    after_minutes: 0,
  })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [peopleSearch, setPeopleSearch] = useState('')

  const { data, loading, revalidate } = useCachedQuery('escalation-matrix', async () => {
    const [{ data: policies }, { data: profs }, { data: roster }, { data: storeRows }] = await Promise.all([
      supabase
        .from('escalation_policies')
        .select(`*, escalation_policy_people(
          profile:profiles(id, name, email, department, role),
          employee:employee_roster(id, name, email, department)
        )`)
        .order('department')
        .order('level'),
      supabase.from('profiles').select('id, name, email, department, role').eq('status', 'active').order('name'),
      supabase.from('employee_roster').select('id, name, email, department').eq('is_active', true).order('name'),
      supabase.from('stores').select('id, store_name, store_code, region').order('store_name'),
    ])

    type RawProfilePerson = { id: string; name: string; email: string | null; department: string | null; role: string | null }
    type RawRosterPerson = { id: string; name: string; email: string | null; department: string | null }
    type RawPolicy = EscalationPolicy & {
      escalation_policy_people?: { profile: RawProfilePerson | null; employee: RawRosterPerson | null }[] | null
    }

    const rows: PolicyRow[] = ((policies as RawPolicy[] | null) ?? []).map((p) => ({
      ...p,
      people: (p.escalation_policy_people ?? [])
        .map((j): Person | null => {
          if (j.profile) return { ...j.profile, source: 'profile' }
          if (j.employee) return { ...j.employee, role: null, source: 'roster' }
          return null
        })
        .filter((x): x is Person => x != null),
    }))

    const profilePeople: Person[] = ((profs as RawProfilePerson[] | null) ?? [])
      .map((p) => ({ ...p, source: 'profile' as const }))
    const rosterPeopleRaw: Person[] = ((roster as RawRosterPerson[] | null) ?? [])
      .map((r) => ({ ...r, role: null, source: 'roster' as const }))

    // A roster employee who's also a dashboard user shows up once, as the profile
    // (that's the account push notifications and role scoping key off).
    const profileEmails = new Set(profilePeople.filter((p) => p.email).map((p) => p.email!.toLowerCase()))
    const rosterPeople = rosterPeopleRaw.filter((r) => !r.email || !profileEmails.has(r.email.toLowerCase()))
    const people = [...profilePeople, ...rosterPeople]

    const stores = (storeRows as StoreOption[] | null) ?? []
    const regions = Array.from(new Set(stores.map((s) => s.region))).sort()
    return { rows, people, stores, regions }
  })

  const rows = useMemo(() => data?.rows ?? [], [data])
  const people = useMemo(() => data?.people ?? [], [data])
  const stores = useMemo(() => data?.stores ?? [], [data])
  const regions = useMemo(() => data?.regions ?? [], [data])
  const storesById = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores])

  // Changing the scope re-suggests the next free level (event-driven, not an effect).
  const updateScope = (patch: Partial<typeof form>) => {
    setForm((f) => {
      const next = { ...f, ...patch }
      next.level = nextLevelFor(rows, next.department, next.region, next.store_id, next.severity)
      return next
    })
  }

  const filteredPeople = useMemo(() => {
    const q = peopleSearch.trim().toLowerCase()
    const base = q
      ? people.filter((p) => p.name.toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q))
      : people
    // People in the chosen department float to the top; dashboard users before roster-only.
    const sorted = [...base].sort((a, b) => {
      const ad = a.department === form.department ? 0 : 1
      const bd = b.department === form.department ? 0 : 1
      if (ad !== bd) return ad - bd
      if (a.source !== b.source) return a.source === 'profile' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return q ? sorted : sorted.slice(0, PEOPLE_PREVIEW_LIMIT)
  }, [people, peopleSearch, form.department])

  const togglePerson = (p: Person) => {
    const key = keyOf(p)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const scopeLabel = form.store_id
    ? storesById.get(form.store_id)?.store_name ?? 'this store'
    : form.region || 'all regions'

  const addRung = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selected.size === 0 || saving) return
    setSaving(true)
    setError('')

    const { data: policy, error: insErr } = await supabase
      .from('escalation_policies')
      .insert({
        department: form.department,
        // A store rung ignores region — the store's own region is implicit.
        region: form.store_id ? null : (form.region || null),
        store_id: form.store_id || null,
        severity: form.severity || null,
        level: form.level,
        after_minutes: form.after_minutes,
      } as never)
      .select('id')
      .single()

    if (insErr || !policy) {
      setError(
        insErr?.message.includes('escalation_policies_store_uniq')
          ? `Level ${form.level} already exists for ${form.department}`
            + `${form.severity ? ` · ${form.severity}` : ''} at ${scopeLabel} — delete it first.`
          : insErr?.message.includes('escalation_policies_region_uniq')
            ? `Level ${form.level} already exists for ${form.department}`
              + `${form.severity ? ` · ${form.severity}` : ''}`
              + `${form.region ? ` · ${form.region}` : ' (all regions)'} — delete it first.`
            : insErr?.message ?? 'Could not create the rung.',
      )
      setSaving(false)
      return
    }

    const policyId = (policy as { id: string }).id
    const links = Array.from(selected).map((key) => {
      const [source, id] = key.split(':')
      return source === 'profile'
        ? { policy_id: policyId, profile_id: id }
        : { policy_id: policyId, employee_roster_id: id }
    })
    const { error: peopleErr } = await supabase.from('escalation_policy_people').insert(links as never)

    if (peopleErr) {
      // Don't leave a peopleless rung behind if the join insert failed.
      await supabase.from('escalation_policies').delete().eq('id', policyId)
      setError(peopleErr.message)
      setSaving(false)
      return
    }

    setSelected(new Set())
    setPeopleSearch('')
    await revalidate()
    setSaving(false)
  }

  const removeRung = async (id: string) => {
    // escalation_policy_people cascades on delete.
    await supabase.from('escalation_policies').delete().eq('id', id)
    await revalidate()
  }

  const byDepartment = useMemo(() => {
    const m = new Map<string, PolicyRow[]>()
    for (const r of rows) m.set(r.department, [...(m.get(r.department) ?? []), r])
    return m
  }, [rows])

  const labelClass = 'block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2'

  return (
    <AppShell
      overline="Automation"
      title="Escalation Matrix"
      subtitle="Per-department escalation ladders. When a ticket breaches SLA, the people on each rung are notified as time passes — ownership stays with the assignee."
    >
      <div className="grid gap-5 grid-cols-1 lg:grid-cols-[400px_1fr] items-start">
        {/* Add rung */}
        {canEdit && (
          <div className="flex flex-col gap-5">
            <GlassPanel padding="md" title="Add escalation rung">
              <form onSubmit={addRung} className="flex flex-col gap-4">
                <div>
                  <label className={labelClass}>Department</label>
                  <select
                    value={form.department}
                    onChange={(e) => updateScope({ department: e.target.value })}
                    className="prism-input"
                  >
                    {CATEGORY_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Region</label>
                    <select
                      value={form.region}
                      disabled={!!form.store_id}
                      onChange={(e) => updateScope({ region: e.target.value })}
                      className="prism-input"
                      style={form.store_id ? { opacity: 0.5 } : undefined}
                    >
                      <option value="">All regions</option>
                      {regions.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Severity</label>
                    <select
                      value={form.severity}
                      onChange={(e) => updateScope({ severity: e.target.value })}
                      className="prism-input"
                    >
                      <option value="">All severities</option>
                      {SEVERITY_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.value}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Store (optional — overrides region)</label>
                  <select
                    value={form.store_id}
                    onChange={(e) => updateScope({ store_id: e.target.value })}
                    className="prism-input"
                  >
                    <option value="">No store override</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>{s.store_name} · {s.store_code}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Level</label>
                    <select
                      value={form.level}
                      onChange={(e) => setForm((f) => ({ ...f, level: Number(e.target.value) }))}
                      className="prism-input"
                    >
                      {LEVELS.map((l) => <option key={l} value={l}>Level {l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Fires</label>
                    <select
                      value={form.after_minutes}
                      onChange={(e) => setForm((f) => ({ ...f, after_minutes: Number(e.target.value) }))}
                      className="prism-input"
                    >
                      {ESCALATION_DELAY_PRESETS.map((d) => (
                        <option key={d.minutes} value={d.minutes}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className={labelClass}>
                    People to notify {selected.size > 0 && `(${selected.size})`}
                  </label>
                  <div className="relative mb-2">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                    <input
                      type="text"
                      value={peopleSearch}
                      onChange={(e) => setPeopleSearch(e.target.value)}
                      placeholder={`Search ${people.length} people…`}
                      className="prism-input pl-9"
                      data-selectable
                    />
                  </div>
                  <div
                    className="max-h-[220px] overflow-y-auto rounded-[10px] flex flex-col"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--border-subtle)' }}
                  >
                    {filteredPeople.length === 0 ? (
                      <p className="text-[11px] text-[var(--text-muted)] px-3 py-3">No matching people.</p>
                    ) : (
                      filteredPeople.map((p) => {
                        const on = selected.has(keyOf(p))
                        return (
                          <button
                            type="button"
                            key={keyOf(p)}
                            onClick={() => togglePerson(p)}
                            className="flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--card-bg-hover)]"
                          >
                            <span
                              className="w-4 h-4 rounded-[5px] flex items-center justify-center shrink-0"
                              style={{
                                background: on ? 'var(--accent)' : 'transparent',
                                border: `1px solid ${on ? 'var(--accent)' : 'var(--border-primary)'}`,
                              }}
                            >
                              {on && <Check size={11} color="#fff" />}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-[12px] font-semibold text-[var(--text-primary)] truncate">{p.name}</span>
                              <span className="block text-[10px] text-[var(--text-muted)] truncate">
                                {p.department ?? '—'}{p.email ? ` · ${p.email}` : ''}
                                {p.source === 'roster' && ' · roster'}
                              </span>
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                  {!peopleSearch.trim() && people.length > PEOPLE_PREVIEW_LIMIT && (
                    <p className="text-[10px] text-[var(--text-muted)] mt-1.5">
                      Showing first {PEOPLE_PREVIEW_LIMIT} of {people.length} — search by name or email to find someone else.
                    </p>
                  )}
                </div>

                {error && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg"
                       style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)' }}>
                    <AlertCircle size={13} className="text-[var(--color-danger)] shrink-0 mt-0.5" />
                    <span className="text-[11px] text-[var(--color-danger)]">{error}</span>
                  </div>
                )}

                <Button type="submit" variant="primary" disabled={saving || selected.size === 0} className="justify-center">
                  <Plus size={14} /> {saving ? 'Adding…' : 'Add rung'}
                </Button>
              </form>
            </GlassPanel>

            <BulkImportPanel people={people} stores={stores} regions={regions} existingRows={rows} onImported={revalidate} />
          </div>
        )}

        {/* Ladders */}
        <div className="flex flex-col gap-4">
          {loading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 120 }} />)}
            </div>
          ) : rows.length === 0 ? (
            <GlassPanel padding="lg" className="text-center">
              <GitBranch size={32} className="mx-auto mb-4 text-[var(--text-muted)]" />
              <p className="text-[14px] font-semibold text-[var(--text-secondary)] mb-1">No escalation ladders yet</p>
              <p className="text-xs text-[var(--text-muted)] max-w-[420px] mx-auto">
                Until a department has rungs, a breached ticket just gets the default one-time
                breach notice. Add rungs to loop specific people in as time passes.
              </p>
            </GlassPanel>
          ) : (
            CATEGORY_LIST.filter((c) => byDepartment.has(c)).map((dept) => (
              <GlassPanel key={dept} padding="md" title={dept}>
                <div className="flex flex-col gap-2.5">
                  {(byDepartment.get(dept) ?? [])
                    .slice()
                    .sort((a, b) =>
                      a.level - b.level
                      || (a.severity ?? '').localeCompare(b.severity ?? '')
                      || (a.region ?? '').localeCompare(b.region ?? ''))
                    .map((r) => {
                      const sev = SEVERITY_OPTIONS.find((s) => s.value === r.severity)
                      const store = r.store_id ? storesById.get(r.store_id) : null
                      return (
                        <div
                          key={r.id}
                          className="rounded-[12px] px-3.5 py-3"
                          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 text-[12px] font-extrabold"
                              style={{ color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)' }}
                            >
                              L{r.level}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--text-secondary)]">
                                  <Clock size={11} /> {formatEscalationDelay(r.after_minutes)}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                                  {store ? <Building2 size={11} /> : r.region ? <MapPin size={11} /> : <Globe2 size={11} />}
                                  {store ? `${store.store_name} · ${store.store_code}` : (r.region ?? 'All regions')}
                                </span>
                                {sev && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                                        style={{ color: sev.color, background: 'var(--bg-tertiary)' }}>
                                    {sev.value}
                                  </span>
                                )}
                                {!r.is_active && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-[var(--text-muted)]"
                                        style={{ background: 'var(--bg-tertiary)' }}>
                                    Paused
                                  </span>
                                )}
                              </div>
                            </div>
                            {canEdit && (
                              <button
                                aria-label="Delete rung"
                                onClick={() => removeRung(r.id)}
                                className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--color-danger)] transition-colors shrink-0"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>

                          <div className="mt-2.5 pl-11 flex items-center gap-1.5 flex-wrap">
                            <Users size={12} className="text-[var(--text-muted)]" />
                            {r.people.length === 0 ? (
                              <span className="text-[11px] text-[var(--color-warning)]">No people — this rung won&apos;t notify anyone.</span>
                            ) : (
                              r.people.map((p) => (
                                <span
                                  key={keyOf(p)}
                                  className="text-[11px] font-medium px-2 py-0.5 rounded-full text-[var(--text-secondary)]"
                                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}
                                  title={[p.email, p.source === 'roster' ? 'roster — no dashboard login' : null].filter(Boolean).join(' · ') || undefined}
                                >
                                  {p.name}
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      )
                    })}
                </div>
              </GlassPanel>
            ))
          )}

          {!canEdit && !loading && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] px-1">
              <ShieldAlert size={13} /> Only leadership and super admins can edit the escalation matrix.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Bulk import — CSV upload for adding many rungs at once
// ─────────────────────────────────────────────────────────────────────────

const CSV_HEADER = 'department,store_code,region,severity,level,after_minutes,people_emails'
const CSV_EXAMPLES = [
  'Operations,,,P0,1,0,area.manager@thirdwavecoffee.in;ops.head@thirdwavecoffee.in',
  'IT,IND-001,,,2,120,it.lead@thirdwavecoffee.in',
]

interface CsvRow {
  line: number
  department: string
  storeCode: string
  region: string
  severity: string
  levelRaw: string
  afterMinutesRaw: string
  peopleRaw: string
  level?: number
  after_minutes?: number
  storeId?: string
  matchedPeople: Person[]
  problem?: string
}

function BulkImportPanel({
  people, stores, regions, existingRows, onImported,
}: {
  people: Person[]
  stores: StoreOption[]
  regions: string[]
  existingRows: PolicyRow[]
  onImported: () => Promise<void>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [fileName, setFileName] = useState('')
  const [csvRows, setCsvRows] = useState<CsvRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ ok: number; failed: number } | null>(null)

  const peopleByEmail = useMemo(() => {
    const m = new Map<string, Person>()
    for (const p of people) if (p.email) m.set(p.email.toLowerCase(), p)
    return m
  }, [people])
  const regionSet = useMemo(() => new Map(regions.map((r) => [r.toLowerCase(), r])), [regions])
  const deptSet = useMemo(() => new Map(CATEGORY_LIST.map((d) => [d.toLowerCase(), d])), [])
  const storeByCode = useMemo(() => new Map(stores.map((s) => [s.store_code.toLowerCase(), s])), [stores])

  const existingCombos = useMemo(() => new Set(
    existingRows.map((r) => `${r.department}|${r.store_id ?? ''}|${(r.region ?? '').toLowerCase()}|${r.severity ?? ''}|${r.level}`),
  ), [existingRows])

  const downloadTemplate = () => downloadCsv('escalation-matrix-template.csv', CSV_HEADER, CSV_EXAMPLES)

  const handleFile = async (file: File | null) => {
    if (!file) return
    setFileName(file.name)
    setResult(null)
    const text = await file.text()
    const parsed = parseCsv(text)
    if (parsed.length < 2) { setCsvRows([]); return }

    const header = parsed[0].map((h) => h.toLowerCase().trim())
    const idx = (col: string) => header.indexOf(col)
    const iDept = idx('department'), iStore = idx('store_code'), iRegion = idx('region'), iSev = idx('severity')
    const iLevel = idx('level'), iAfter = idx('after_minutes'), iPeople = idx('people_emails')

    const seenInFile = new Set<string>()

    const out: CsvRow[] = parsed.slice(1).map((cells, n) => {
      const get = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '')
      const r: CsvRow = {
        line: n + 2,
        department: get(iDept),
        storeCode: get(iStore),
        region: get(iRegion),
        severity: get(iSev),
        levelRaw: get(iLevel),
        afterMinutesRaw: get(iAfter),
        peopleRaw: get(iPeople),
        matchedPeople: [],
      }

      const deptCanon = deptSet.get(r.department.toLowerCase())
      const storeMatch = r.storeCode ? storeByCode.get(r.storeCode.toLowerCase()) : undefined
      // A store scope ignores region — the store's own region is implicit.
      const regionCanon = r.storeCode ? '' : (r.region ? regionSet.get(r.region.toLowerCase()) : '')
      const severity = r.severity.toUpperCase()
      const level = Number(r.levelRaw)
      const afterMinutes = r.afterMinutesRaw === '' ? 0 : Number(r.afterMinutesRaw)
      const emails = r.peopleRaw.split(/[;,]/).map((e) => e.trim()).filter(Boolean)
      const matched = emails.map((e) => peopleByEmail.get(e.toLowerCase())).filter((p): p is Person => p != null)
      const unmatched = emails.filter((e) => !peopleByEmail.get(e.toLowerCase()))

      r.department = deptCanon ?? r.department
      r.region = regionCanon ?? r.region
      r.storeId = storeMatch?.id
      r.severity = severity
      r.level = level
      r.after_minutes = afterMinutes
      r.matchedPeople = matched

      if (!deptCanon) {
        r.problem = `Unknown department "${r.department}"`
      } else if (r.storeCode && !storeMatch) {
        r.problem = `Unknown store code "${r.storeCode}"`
      } else if (r.region && !r.storeCode && !regionCanon) {
        r.problem = `Unknown region "${r.region}"`
      } else if (severity && !SEVERITY_OPTIONS.some((s) => s.value === severity)) {
        r.problem = `Unknown severity "${severity}" (use P0–P3 or leave blank)`
      } else if (!Number.isInteger(level) || level < 1 || level > 6) {
        r.problem = 'Level must be a number 1–6'
      } else if (!Number.isInteger(afterMinutes) || afterMinutes < 0) {
        r.problem = 'after_minutes must be a whole number ≥ 0'
      } else if (emails.length === 0) {
        r.problem = 'No people listed'
      } else if (unmatched.length > 0) {
        r.problem = `No match for: ${unmatched.join(', ')}`
      } else {
        const combo = `${deptCanon}|${r.storeId ?? ''}|${(regionCanon ?? '').toLowerCase()}|${severity}|${level}`
        if (existingCombos.has(combo)) {
          r.problem = `Level ${level} already exists for ${deptCanon}${severity ? ` · ${severity}` : ''}`
            + `${storeMatch ? ` · ${storeMatch.store_name}` : regionCanon ? ` · ${regionCanon}` : ' (all regions)'} — skipped`
        } else if (seenInFile.has(combo)) {
          r.problem = 'Duplicate row in this file — skipped'
        } else {
          seenInFile.add(combo)
        }
      }

      return r
    })
    setCsvRows(out)
  }

  const valid = csvRows.filter((r) => !r.problem)
  const invalid = csvRows.filter((r) => r.problem)

  const runImport = async () => {
    if (valid.length === 0 || importing) return
    setImporting(true)
    let ok = 0, failed = 0

    for (const r of valid) {
      const { data: policy, error: insErr } = await supabase
        .from('escalation_policies')
        .insert({
          department: r.department,
          region: r.region || null,
          store_id: r.storeId ?? null,
          severity: r.severity || null,
          level: r.level!,
          after_minutes: r.after_minutes!,
        } as never)
        .select('id')
        .single()

      if (insErr || !policy) { failed++; continue }

      const policyId = (policy as { id: string }).id
      const links = r.matchedPeople.map((p) => (
        p.source === 'profile'
          ? { policy_id: policyId, profile_id: p.id }
          : { policy_id: policyId, employee_roster_id: p.id }
      ))
      const { error: peopleErr } = await supabase.from('escalation_policy_people').insert(links as never)
      if (peopleErr) {
        await supabase.from('escalation_policies').delete().eq('id', policyId)
        failed++
        continue
      }
      ok++
    }

    setResult({ ok, failed })
    setCsvRows([])
    setFileName('')
    setImporting(false)
    await onImported()
  }

  return (
    <GlassPanel padding="md">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2"
      >
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-primary)]">
          <Upload size={13} /> Bulk import via CSV
        </span>
        {open ? <ChevronUp size={14} className="text-[var(--text-muted)]" /> : <ChevronDown size={14} className="text-[var(--text-muted)]" />}
      </button>

      {open && (
        <div className="flex flex-col gap-3 mt-4">
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            Add many rungs at once — download the template, fill it in, then upload it.
            Store, region and severity blank mean &ldquo;all&rdquo;; a store code overrides region.
            {' '}<code className="font-mono-value text-[11px]">people_emails</code> is
            {' '}a semicolon-separated list, matched against dashboard users and the Prism Platform employee roster by email.
          </p>

          <code
            className="block text-[10px] font-mono px-2.5 py-1.5 rounded-[6px] leading-relaxed overflow-x-auto whitespace-nowrap"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            {CSV_HEADER}
          </code>

          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" type="button" onClick={downloadTemplate}>
              <Download size={13} /> Download template
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { handleFile(e.target.files?.[0] ?? null); e.target.value = '' }}
            />
            <Button variant="primary" size="sm" type="button" onClick={() => fileRef.current?.click()}>
              <Upload size={13} /> Choose CSV
            </Button>
            {fileName && <span className="text-[11px] text-[var(--text-muted)]">{fileName}</span>}
          </div>

          {csvRows.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <p className="text-[11px] font-semibold text-[var(--text-secondary)]">
                {valid.length} ready, {invalid.length} with problems
              </p>

              {invalid.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {invalid.slice(0, 8).map((r) => (
                    <div key={r.line} className="flex items-start gap-2 px-2.5 py-1.5 rounded-[8px] text-[11px]"
                         style={{ background: 'rgba(234,179,8,0.07)', border: '1px solid rgba(234,179,8,0.22)' }}>
                      <AlertTriangle size={11} className="shrink-0 mt-0.5" style={{ color: 'var(--color-warning)' }} />
                      <span className="text-[var(--text-secondary)]">Line {r.line}: {r.problem}</span>
                    </div>
                  ))}
                  {invalid.length > 8 && (
                    <p className="text-[10px] text-[var(--text-muted)] px-1">…and {invalid.length - 8} more with problems.</p>
                  )}
                </div>
              )}

              {valid.length > 0 && (
                <div className="max-h-[200px] overflow-y-auto rounded-[10px]" style={{ border: '1px solid var(--border-subtle)' }}>
                  {valid.map((r) => (
                    <div key={r.line} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]"
                         style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <span className="font-semibold text-[var(--text-primary)] shrink-0">L{r.level}</span>
                      <span className="text-[var(--text-secondary)] truncate">
                        {r.department}{r.severity ? ` · ${r.severity}` : ''} · {r.storeId ? r.storeCode : (r.region || 'All regions')}
                      </span>
                      <span className="text-[var(--text-muted)] shrink-0 ml-auto">{r.matchedPeople.length} people</span>
                    </div>
                  ))}
                </div>
              )}

              <Button
                variant="primary"
                type="button"
                disabled={importing || valid.length === 0}
                onClick={runImport}
                className="justify-center"
              >
                {importing ? 'Importing…' : `Import ${valid.length} rung${valid.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          )}

          {result && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-[8px]"
                 style={{ background: result.failed ? 'rgba(234,179,8,0.07)' : 'rgba(34,197,94,0.08)', border: `1px solid ${result.failed ? 'rgba(234,179,8,0.22)' : 'rgba(34,197,94,0.2)'}` }}>
              <CheckCircle2 size={14} style={{ color: result.failed ? 'var(--color-warning)' : 'var(--color-success)' }} />
              <span className="text-[12px] text-[var(--text-secondary)]">
                {result.ok} rung{result.ok === 1 ? '' : 's'} imported{result.failed ? `, ${result.failed} failed` : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </GlassPanel>
  )
}
