'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { CATEGORY_LIST } from '@/lib/ticket-utils'
import type { DepartmentRouting, Profile, Store } from '@/lib/supabase/database.types'
import { Route, Plus, Trash2, Globe2, MapPin, Building2, AlertCircle } from 'lucide-react'

type StoreOption = Pick<Store, 'id' | 'store_name' | 'store_code' | 'region'>
type RoutingRow = DepartmentRouting & { owner?: Pick<Profile, 'id' | 'name' | 'email'> | null }

export default function RoutingPage() {
  const { profile } = useAuthStore()
  const canEdit = profile?.role === 'super_admin' || profile?.role === 'leadership'

  const [rows, setRows] = useState<RoutingRow[]>([])
  const [people, setPeople] = useState<Pick<Profile, 'id' | 'name' | 'email' | 'department' | 'role'>[]>([])
  const [stores, setStores] = useState<StoreOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({ department: 'Maintenance', region: '', store_id: '', owner_id: '' })

  const fetchAll = useCallback(async () => {
    const [{ data: routing }, { data: profs }, { data: storeRows }] = await Promise.all([
      supabase.from('department_routing').select('*').order('department'),
      supabase.from('profiles').select('id, name, email, department, role').eq('status', 'active').order('name'),
      supabase.from('stores').select('id, store_name, store_code, region').order('store_name'),
    ])

    const profMap = new Map((profs ?? []).map((p) => [p.id, p]))
    setRows(((routing as DepartmentRouting[] | null) ?? []).map((r) => ({
      ...r,
      owner: profMap.get(r.owner_id) ?? null,
    })))
    setPeople((profs as typeof people | null) ?? [])
    setStores((storeRows as StoreOption[] | null) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const regions = useMemo(() => Array.from(new Set(stores.map((s) => s.region))).sort(), [stores])
  const storesById = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores])

  // Owner suggestions: people in the picked department first, then everyone
  const ownerOptions = useMemo(() => {
    const inDept = people.filter((p) => p.department === form.department)
    const others = people.filter((p) => p.department !== form.department)
    return { inDept, others }
  }, [people, form.department])

  const scopeLabel = form.store_id
    ? storesById.get(form.store_id)?.store_name ?? 'this store'
    : form.region || 'all regions (when no region rule matches)'

  const addRule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.owner_id || saving) return
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('department_routing').insert({
      department: form.department,
      // A store rule ignores region — the store's own region is implicit.
      region: form.store_id ? null : (form.region || null),
      store_id: form.store_id || null,
      owner_id: form.owner_id,
    } as never)
    if (err) {
      setError(
        err.message.includes('department_routing_store_uniq')
          ? `A rule for ${form.department} at this store already exists — delete it first.`
          : err.message.includes('department_routing_region_uniq')
            ? `A rule for ${form.department} in ${form.region || 'All regions'} already exists — delete it first.`
            : err.message,
      )
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
      subtitle="Who owns each department's tickets, per store or region. New tickets are auto-assigned and notified instantly."
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
                  disabled={!!form.store_id}
                  onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
                  className="prism-input"
                  style={form.store_id ? { opacity: 0.5 } : undefined}
                >
                  <option value="">All regions (fallback)</option>
                  {regions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Store (optional — overrides region)</label>
                <select
                  value={form.store_id}
                  onChange={(e) => setForm((f) => ({ ...f, store_id: e.target.value }))}
                  className="prism-input"
                >
                  <option value="">No store override</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>{s.store_name} · {s.store_code}</option>
                  ))}
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
                  They&apos;ll be auto-assigned + emailed for every new {form.department} ticket in {scopeLabel}.
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
                Add one owner per department (plus store or region overrides where needed).
              </p>
            </GlassPanel>
          ) : (
            CATEGORY_LIST.filter((c) => byDepartment.has(c)).map((dept) => (
              <GlassPanel key={dept} padding="md" title={dept}>
                <div className="flex flex-col gap-2">
                  {(byDepartment.get(dept) ?? [])
                    .slice()
                    .sort((a, b) => {
                      const as = a.store_id ? 0 : 1, bs = b.store_id ? 0 : 1
                      if (as !== bs) return as - bs
                      return (a.region ?? '').localeCompare(b.region ?? '')
                    })
                    .map((r) => {
                      const store = r.store_id ? storesById.get(r.store_id) : null
                      return (
                        <div
                          key={r.id}
                          className="flex items-center gap-3 px-3.5 py-2.5 rounded-[10px]"
                          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
                        >
                          <span
                            className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0"
                            style={{
                              color: store ? 'var(--accent)' : r.region ? 'var(--color-info)' : 'var(--text-muted)',
                              background: 'var(--bg-tertiary)',
                            }}
                          >
                            {store ? <Building2 size={14} /> : r.region ? <MapPin size={14} /> : <Globe2 size={14} />}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-semibold text-[var(--text-primary)] truncate">
                              {r.owner?.name ?? 'Unknown user'}
                            </span>
                            <span className="block text-[11px] text-[var(--text-muted)] truncate">
                              {store ? `${store.store_name} · ${store.store_code}` : r.region ?? 'All regions (fallback)'}
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
                      )
                    })}
                </div>
              </GlassPanel>
            ))
          )}
        </div>
      </div>
    </AppShell>
  )
}
