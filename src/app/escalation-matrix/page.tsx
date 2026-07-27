'use client'

import { useMemo, useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase/client'
import { useCachedQuery } from '@/lib/use-cached-query'
import { useAuthStore } from '@/store/auth.store'
import {
  CATEGORY_LIST, SEVERITY_OPTIONS, ESCALATION_DELAY_PRESETS, formatEscalationDelay,
} from '@/lib/ticket-utils'
import type { EscalationPolicy, Profile } from '@/lib/supabase/database.types'
import {
  GitBranch, Plus, Trash2, Globe2, MapPin, AlertCircle, Clock, Users, Check, Search, ShieldAlert,
} from 'lucide-react'

type Person = Pick<Profile, 'id' | 'name' | 'email' | 'department' | 'role'>
type PolicyRow = EscalationPolicy & { people: Person[] }

const LEVELS = [1, 2, 3, 4, 5, 6]

/** Lowest level (1..6) not yet used for this exact department/region/severity scope. */
function nextLevelFor(rows: PolicyRow[], department: string, region: string, severity: string): number {
  const used = rows
    .filter((r) => r.department === department && (r.region ?? '') === region && (r.severity ?? '') === severity)
    .map((r) => r.level)
  return LEVELS.find((l) => !used.includes(l)) ?? 1
}

export default function EscalationMatrixPage() {
  const { profile } = useAuthStore()
  const canEdit = profile?.role === 'super_admin' || profile?.role === 'leadership'

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    department: CATEGORY_LIST[0],
    region: '',
    severity: '',
    level: 1,
    after_minutes: 0,
  })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [peopleSearch, setPeopleSearch] = useState('')

  const { data, loading, revalidate } = useCachedQuery('escalation-matrix', async () => {
    const [{ data: policies }, { data: profs }, { data: stores }] = await Promise.all([
      supabase
        .from('escalation_policies')
        .select('*, escalation_policy_people(profile:profiles(id, name, email, department, role))')
        .order('department')
        .order('level'),
      supabase.from('profiles').select('id, name, email, department, role').eq('status', 'active').order('name'),
      supabase.from('stores').select('region'),
    ])

    type RawPolicy = EscalationPolicy & {
      escalation_policy_people?: { profile: Person | null }[] | null
    }
    const rows: PolicyRow[] = ((policies as RawPolicy[] | null) ?? []).map((p) => ({
      ...p,
      people: (p.escalation_policy_people ?? [])
        .map((j) => j.profile)
        .filter((x): x is Person => x != null),
    }))
    const people = (profs as Person[] | null) ?? []
    const regions = Array.from(new Set(((stores ?? []) as { region: string }[]).map((s) => s.region))).sort()
    return { rows, people, regions }
  })

  const rows = useMemo(() => data?.rows ?? [], [data])
  const people = useMemo(() => data?.people ?? [], [data])
  const regions = useMemo(() => data?.regions ?? [], [data])

  // Changing the scope re-suggests the next free level (event-driven, not an effect).
  const updateScope = (patch: Partial<typeof form>) => {
    setForm((f) => {
      const next = { ...f, ...patch }
      next.level = nextLevelFor(rows, next.department, next.region, next.severity)
      return next
    })
  }

  const filteredPeople = useMemo(() => {
    const q = peopleSearch.trim().toLowerCase()
    const base = q
      ? people.filter((p) => p.name.toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q))
      : people
    // People in the chosen department float to the top.
    return [...base].sort((a, b) => {
      const ad = a.department === form.department ? 0 : 1
      const bd = b.department === form.department ? 0 : 1
      return ad - bd || a.name.localeCompare(b.name)
    })
  }, [people, peopleSearch, form.department])

  const togglePerson = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const addRung = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selected.size === 0 || saving) return
    setSaving(true)
    setError('')

    const { data: policy, error: insErr } = await supabase
      .from('escalation_policies')
      .insert({
        department: form.department,
        region: form.region || null,
        severity: form.severity || null,
        level: form.level,
        after_minutes: form.after_minutes,
      } as never)
      .select('id')
      .single()

    if (insErr || !policy) {
      setError(
        insErr?.message.includes('escalation_policies_unique')
          ? `Level ${form.level} already exists for ${form.department}`
            + `${form.severity ? ` · ${form.severity}` : ''}`
            + `${form.region ? ` · ${form.region}` : ' (all regions)'} — delete it first.`
          : insErr?.message ?? 'Could not create the rung.',
      )
      setSaving(false)
      return
    }

    const policyId = (policy as { id: string }).id
    const links = Array.from(selected).map((profile_id) => ({ policy_id: policyId, profile_id }))
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
                    onChange={(e) => updateScope({ region: e.target.value })}
                    className="prism-input"
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
                    placeholder="Search people…"
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
                      const on = selected.has(p.id)
                      return (
                        <button
                          type="button"
                          key={p.id}
                          onClick={() => togglePerson(p.id)}
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
                            </span>
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
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
                                  {r.region ? <MapPin size={11} /> : <Globe2 size={11} />}
                                  {r.region ?? 'All regions'}
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
                                  key={p.id}
                                  className="text-[11px] font-medium px-2 py-0.5 rounded-full text-[var(--text-secondary)]"
                                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}
                                  title={p.email ?? undefined}
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
