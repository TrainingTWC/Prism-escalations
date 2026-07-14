'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { CATEGORY_LIST } from '@/lib/ticket-utils'
import type { DepartmentRouting, Profile } from '@/lib/supabase/database.types'
import { Route, Plus, Trash2, Globe2, MapPin, AlertCircle } from 'lucide-react'

type RoutingRow = DepartmentRouting & { owner?: Pick<Profile, 'id' | 'name' | 'email'> | null }

export default function RoutingPage() {
  const { profile } = useAuthStore()
  const canEdit = profile?.role === 'super_admin' || profile?.role === 'leadership'

  const [rows, setRows] = useState<RoutingRow[]>([])
  const [people, setPeople] = useState<Pick<Profile, 'id' | 'name' | 'email' | 'department' | 'role'>[]>([])
  const [regions, setRegions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({ department: 'Maintenance', region: '', owner_id: '' })

  const fetchAll = useCallback(async () => {
    const [{ data: routing }, { data: profs }, { data: stores }] = await Promise.all([
      supabase.from('department_routing').select('*').order('department'),
      supabase.from('profiles').select('id, name, email, department, role').eq('status', 'active').order('name'),
      supabase.from('stores').select('region'),
    ])

    const profMap = new Map((profs ?? []).map((p) => [p.id, p]))
    setRows(((routing as DepartmentRouting[] | null) ?? []).map((r) => ({
      ...r,
      owner: profMap.get(r.owner_id) ?? null,
    })))
    setPeople((profs as typeof people | null) ?? [])
    setRegions(Array.from(new Set(((stores ?? []) as { region: string }[]).map((s) => s.region))).sort())
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Owner suggestions: people in the picked department first, then everyone
  const ownerOptions = useMemo(() => {
    const inDept = people.filter((p) => p.department === form.department)
    const others = people.filter((p) => p.department !== form.department)
    return { inDept, others }
  }, [people, form.department])

  const addRule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.owner_id || saving) return
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('department_routing').insert({
      department: form.department,
      region: form.region || null,
      owner_id: form.owner_id,
    } as never)
    if (err) {
      setError(err.message.includes('department_routing_unique')
        ? `A rule for ${form.department} in ${form.region || 'All regions'} already exists — delete it first.`
        : err.message)
    } else {
      setForm((f) => ({ ...f, owner_id: '' }))
      await fetchAll()
    }
    setSaving(false)
  }

  const removeRule = async (id: string) => {
    await supabase.from('department_routing').delete().eq('id', id)
    await fetchAll()
  }

  const byDepartment = useMemo(() => {
    const m = new Map<string, RoutingRow[]>()
    for (const r of rows) {
      m.set(r.department, [...(m.get(r.department) ?? []), r])
    }
    return m
  }, [rows])

  const labelClass = 'block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2'

  return (
    <AppShell
      overline="Automation"
      title="Ticket Routing"
      subtitle="Who owns each department's tickets, per region. New tickets are auto-assigned and notified instantly."
    >
      <div className="grid gap-5 grid-cols-1 lg:grid-cols-[380px_1fr] items-start">
        {/* Add rule */}
        {canEdit && (
          <GlassPanel padding="md" title="Add routing rule">
            <form onSubmit={addRule} className="flex flex-col gap-4">
              <div>
                <label className={labelClass}>Department</label>
                <select
                  value={form.department}
                  onChange={(e) => setForm((f) => ({ ...f, department: e.target.value, owner_id: '' }))}
                  className="prism-input"
                >
                  {CATEGORY_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Region</label>
                <select
                  value={form.region}
                  onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
                  className="prism-input"
                >
                  <option value="">All regions (fallback)</option>
                  {regions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Owner</label>
                <select
                  value={form.owner_id}
                  onChange={(e) => setForm((f) => ({ ...f, owner_id: e.target.value }))}
                  required
                  className="prism-input"
                >
                  <option value="">Select person…</option>
                  {ownerOptions.inDept.length > 0 && (
                    <optgroup label={`${form.department} team`}>
                      {ownerOptions.inDept.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </optgroup>
                  )}
                  <optgroup label="Everyone">
                    {ownerOptions.others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </optgroup>
                </select>
                <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                  They&apos;ll be auto-assigned + emailed for every new {form.department} ticket
                  {form.region ? ` in ${form.region}` : ' (when no region rule matches)'}.
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
                     style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)' }}>
                  <AlertCircle size={13} className="text-[var(--color-danger)] shrink-0" />
                  <span className="text-[11px] text-[var(--color-danger)]">{error}</span>
                </div>
              )}

              <Button type="submit" variant="primary" disabled={saving || !form.owner_id} className="justify-center">
                <Plus size={14} /> {saving ? 'Adding…' : 'Add rule'}
              </Button>
            </form>
          </GlassPanel>
        )}

        {/* Rules */}
        <div className="flex flex-col gap-4">
          {loading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 90 }} />)}
            </div>
          ) : rows.length === 0 ? (
            <GlassPanel padding="lg" className="text-center">
              <Route size={32} className="mx-auto mb-4 text-[var(--text-muted)]" />
              <p className="text-[14px] font-semibold text-[var(--text-secondary)] mb-1">No routing rules yet</p>
              <p className="text-xs text-[var(--text-muted)] max-w-[400px] mx-auto">
                Until rules are added, new tickets stay unassigned in the department queue.
                Add one owner per department (plus regional overrides where needed).
              </p>
            </GlassPanel>
          ) : (
            CATEGORY_LIST.filter((c) => byDepartment.has(c)).map((dept) => (
              <GlassPanel key={dept} padding="md" title={dept}>
                <div className="flex flex-col gap-2">
                  {(byDepartment.get(dept) ?? [])
                    .sort((a, b) => (a.region ?? '').localeCompare(b.region ?? ''))
                    .map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center gap-3 px-3.5 py-2.5 rounded-[10px]"
                        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
                      >
                        <span
                          className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0"
                          style={{
                            color: r.region ? 'var(--accent)' : 'var(--color-info)',
                            background: 'var(--bg-tertiary)',
                          }}
                        >
                          {r.region ? <MapPin size={14} /> : <Globe2 size={14} />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] font-semibold text-[var(--text-primary)] truncate">
                            {r.owner?.name ?? 'Unknown user'}
                          </span>
                          <span className="block text-[11px] text-[var(--text-muted)]">
                            {r.region ?? 'All regions (fallback)'}
                            {r.owner?.email ? ` · ${r.owner.email}` : ''}
                          </span>
                        </span>
                        {canEdit && (
                          <button
                            aria-label="Delete rule"
                            onClick={() => removeRule(r.id)}
                            className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--color-danger)] transition-colors shrink-0"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              </GlassPanel>
            ))
          )}
        </div>
      </div>
    </AppShell>
  )
}
