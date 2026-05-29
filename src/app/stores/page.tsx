'use client'

import { useEffect, useState, useMemo } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { supabase } from '@/lib/supabase/client'
import { Building2, MapPin, Users, Layers, Search } from 'lucide-react'

interface StoreRow {
  id: string
  store_name: string
  store_code: string
  city: string | null
  region: string
  tier: string
  created_at: string
}

interface EmpSlice {
  emp_id: string
  store_code: string | null
  department: string | null
  is_active: boolean
}

export default function StoresPage() {
  const [stores, setStores] = useState<StoreRow[]>([])
  const [employees, setEmployees] = useState<EmpSlice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState('All')

  useEffect(() => {
    async function load() {
      // Fetch stores (≤218 rows, no pagination needed)
      const { data: storeData } = await supabase.from('stores').select('*').order('store_name')
      setStores((storeData as StoreRow[]) ?? [])

      // Paginate employee_roster in 1000-row pages (Supabase PostgREST default cap)
      const PAGE = 1000
      const allEmps: EmpSlice[] = []
      let offset = 0
      while (true) {
        const { data: page } = await supabase
          .from('employee_roster')
          .select('emp_id, store_code, department, is_active')
          .eq('is_active', true)
          .range(offset, offset + PAGE - 1)
        if (!page || page.length === 0) break
        allEmps.push(...(page as EmpSlice[]))
        if (page.length < PAGE) break
        offset += PAGE
      }
      setEmployees(allEmps)
      setLoading(false)
    }
    load()
  }, [])

  // employees per store_code
  const empByStore = useMemo(() => {
    const m = new Map<string, number>()
    employees.forEach((e) => {
      if (e.store_code) m.set(e.store_code, (m.get(e.store_code) ?? 0) + 1)
    })
    return m
  }, [employees])

  // distinct departments + headcount
  const departments = useMemo(() => {
    const m = new Map<string, number>()
    employees.forEach((e) => {
      if (e.department) m.set(e.department, (m.get(e.department) ?? 0) + 1)
    })
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [employees])
      setLoading(false)
    }
    load()
  }, [])

  // employees per store_code
  const empByStore = useMemo(() => {
    const m = new Map<string, number>()
    employees.forEach((e) => {
      if (e.store_code) m.set(e.store_code, (m.get(e.store_code) ?? 0) + 1)
    })
    return m
  }, [employees])

  // distinct departments + headcount
  const departments = useMemo(() => {
    const m = new Map<string, number>()
    employees.forEach((e) => {
      if (e.department) m.set(e.department, (m.get(e.department) ?? 0) + 1)
    })
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [employees])

  // region pills
  const regions = useMemo(
    () => ['All', ...Array.from(new Set(stores.map((s) => s.region))).sort()],
    [stores],
  )

  const regionBreakdown = useMemo(() => {
    const m = new Map<string, number>()
    stores.forEach((s) => m.set(s.region, (m.get(s.region) ?? 0) + 1))
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [stores])

  const filtered = useMemo(
    () =>
      stores.filter((s) => {
        const q = search.toLowerCase()
        const matchSearch =
          !q ||
          s.store_name.toLowerCase().includes(q) ||
          s.store_code.toLowerCase().includes(q) ||
          (s.city ?? '').toLowerCase().includes(q)
        const matchRegion = regionFilter === 'All' || s.region === regionFilter
        return matchSearch && matchRegion
      }),
    [stores, search, regionFilter],
  )

  return (
    <AppShell
      overline="Network"
      title="Stores"
      subtitle="All retail locations synced from Prism Platform."
    >
      <div className="max-w-[1000px] flex flex-col gap-5">

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total stores', value: stores.length || '—' },
            { label: 'Regions', value: regionBreakdown.length || '—' },
            { label: 'Active employees', value: employees.length || '—', accent: true },
            { label: 'Departments', value: departments.length || '—' },
          ].map(({ label, value, accent }) => (
            <GlassPanel key={label} padding="md">
              <p className="text-[11px] text-[var(--text-muted)] mb-1">{label}</p>
              <p
                className="text-[22px] font-bold"
                style={{ color: accent ? 'var(--color-success)' : 'var(--text-primary)' }}
              >
                {loading ? '—' : value}
              </p>
            </GlassPanel>
          ))}
        </div>

        {/* Region filter chips */}
        {!loading && regionBreakdown.length > 0 && (
          <GlassPanel padding="md" title="By region">
            <div className="flex flex-wrap gap-2">
              {regions.map((r) => {
                const count = r === 'All' ? stores.length : (regionBreakdown.find(([rr]) => rr === r)?.[1] ?? 0)
                const active = regionFilter === r
                return (
                  <button
                    key={r}
                    onClick={() => setRegionFilter(r)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[11px] font-semibold transition-all"
                    style={{
                      background: active ? 'var(--accent-dim)' : 'var(--bg-secondary)',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border-subtle)'}`,
                      color: active ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    {r}
                    <span
                      className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full"
                      style={{
                        background: active ? 'var(--accent)' : 'var(--bg-tertiary)',
                        color: active ? '#000' : 'var(--text-muted)',
                      }}
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          </GlassPanel>
        )}

        {/* Departments from employee master */}
        {!loading && departments.length > 0 && (
          <GlassPanel
            padding="md"
            title={
              <span className="inline-flex items-center gap-1.5">
                <Layers size={13} />
                Departments · employee master
              </span>
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {departments.map(([dept, count]) => (
                <div
                  key={dept}
                  className="flex items-center justify-between px-3 py-2 rounded-[8px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}
                >
                  <span className="text-[11px] text-[var(--text-secondary)] truncate mr-2">{dept}</span>
                  <span
                    className="text-[10px] font-mono font-bold shrink-0 px-1.5 py-0.5 rounded-full"
                    style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
                  >
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </GlassPanel>
        )}

        {/* Store list */}
        <GlassPanel
          padding="md"
          title={
            <span className="inline-flex items-center gap-1.5">
              <Building2 size={13} />
              Stores
              {regionFilter !== 'All' && (
                <span className="text-[10px] font-normal text-[var(--accent)] ml-1 normal-case tracking-normal">
                  · {regionFilter}
                </span>
              )}
            </span>
          }
        >
          {/* Search */}
          <div className="relative mb-3">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search by name, code or city…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-[12px] rounded-[8px] outline-none"
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          {loading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 44 }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-[13px] text-[var(--text-muted)] text-center py-8">No stores match</p>
          ) : (
            <>
              <p className="text-[10px] text-[var(--text-muted)] mb-2">
                Showing {filtered.length} of {stores.length}
              </p>
              <div className="flex flex-col gap-1.5 max-h-[520px] overflow-y-auto pr-0.5">
                {filtered.map((store) => {
                  const emp = empByStore.get(store.store_code) ?? 0
                  return (
                    <div
                      key={store.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-[10px]"
                      style={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      {/* Icon */}
                      <div
                        className="w-7 h-7 rounded-[7px] flex items-center justify-center shrink-0"
                        style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
                      >
                        <Building2 size={13} />
                      </div>

                      {/* Name + meta */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                          {store.store_name}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] font-mono text-[var(--text-muted)]">
                            {store.store_code}
                          </span>
                          {store.city && (
                            <>
                              <span className="text-[var(--border-primary)]">·</span>
                              <span className="flex items-center gap-0.5 text-[10px] text-[var(--text-muted)]">
                                <MapPin size={8} />
                                {store.city}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Region */}
                      <span
                        className="hidden sm:block text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
                      >
                        {store.region}
                      </span>

                      {/* Employee count */}
                      {emp > 0 && (
                        <span
                          className="flex items-center gap-1 text-[10px] font-bold shrink-0"
                          style={{ color: 'var(--color-success)' }}
                        >
                          <Users size={10} />
                          {emp}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </GlassPanel>

      </div>
    </AppShell>
  )
}

