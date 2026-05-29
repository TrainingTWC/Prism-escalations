'use client'

import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { Users, ShieldCheck, Building2, RefreshCw, Check, ChevronDown } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

const ROLES = [
  { value: 'store_team',    label: 'Store Team',    color: 'var(--text-muted)' },
  { value: 'store_manager', label: 'Store Manager', color: 'var(--color-success)' },
  { value: 'area_manager',  label: 'Area Manager',  color: '#60a5fa' },
  { value: 'admin',         label: 'Admin',         color: 'var(--color-warning)' },
  { value: 'super_admin',   label: 'Super Admin',   color: 'var(--accent)' },
]

function roleMeta(role: string) {
  return ROLES.find((r) => r.value === role) ?? { value: role, label: role, color: 'var(--text-muted)' }
}

interface ProfileRow {
  id: string
  name: string
  email: string
  role: string
  emp_id: string | null
  region: string | null
  department: string | null
  status: string
  created_at: string
}

interface RosterStats {
  total: number
  active: number
  lastSync: string | null
}

function RolePill({ role }: { role: string }) {
  const meta = roleMeta(role)
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.06em]"
      style={{ color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}33` }}
    >
      {meta.label}
    </span>
  )
}

function RoleDropdown({
  currentRole,
  profileId,
  selfId,
  onUpdated,
}: {
  currentRole: string
  profileId: string
  selfId: string
  onUpdated: (id: string, role: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const isSelf = profileId === selfId

  const pick = async (role: string) => {
    if (role === currentRole) { setOpen(false); return }
    setSaving(true)
    setOpen(false)
    await supabase.from('profiles').update({ role } as never).eq('id', profileId)
    onUpdated(profileId, role)
    setSaving(false)
  }

  if (isSelf) return <RolePill role={currentRole} />

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.06em] transition-opacity"
        style={{
          color: roleMeta(currentRole).color,
          background: `${roleMeta(currentRole).color}18`,
          border: `1px solid ${roleMeta(currentRole).color}33`,
          opacity: saving ? 0.5 : 1,
          cursor: saving ? 'not-allowed' : 'pointer',
        }}
      >
        {saving ? '…' : roleMeta(currentRole).label}
        {!saving && <ChevronDown size={9} />}
      </button>

      {open && (
        <div
          className="absolute z-50 right-0 top-7 rounded-[10px] py-1 w-[160px] shadow-xl"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-primary)' }}
        >
          {ROLES.map((r) => (
            <button
              key={r.value}
              onClick={() => pick(r.value)}
              className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] hover:bg-[var(--bg-tertiary)] transition-colors"
              style={{ color: r.color }}
            >
              {r.label}
              {r.value === currentRole && <Check size={11} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TeamPage() {
  const { profile: self } = useAuthStore()
  const isSuperAdmin = self?.role === 'super_admin'

  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [roster, setRoster] = useState<RosterStats>({ total: 0, active: 0, lastSync: null })
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    const [{ data: profs }, { data: rosterData }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('employee_roster').select('is_active, last_synced_at').order('last_synced_at', { ascending: false }).limit(1),
    ])

    setProfiles((profs as ProfileRow[]) || [])

    if (rosterData && rosterData.length > 0) {
      const { count: total } = await supabase.from('employee_roster').select('*', { count: 'exact', head: true })
      const { count: active } = await supabase.from('employee_roster').select('*', { count: 'exact', head: true }).eq('is_active', true)
      setRoster({ total: total ?? 0, active: active ?? 0, lastSync: rosterData[0].last_synced_at })
    }

    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleRoleUpdate = (id: string, role: string) => {
    setProfiles((prev) => prev.map((p) => p.id === id ? { ...p, role } : p))
  }

  const roleGroups = ROLES.slice().reverse().map((r) => ({
    ...r,
    count: profiles.filter((p) => p.role === r.value).length,
  }))

  return (
    <AppShell
      overline="People"
      title="Team"
      subtitle="Users, roles and permissions across the escalation hierarchy."
    >
      <div className="max-w-[900px] flex flex-col gap-5">

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <GlassPanel padding="md">
            <p className="text-[11px] text-[var(--text-muted)] mb-1">Dashboard users</p>
            <p className="text-[22px] font-bold text-[var(--text-primary)]">{profiles.length}</p>
          </GlassPanel>
          <GlassPanel padding="md">
            <p className="text-[11px] text-[var(--text-muted)] mb-1">Total employees</p>
            <p className="text-[22px] font-bold text-[var(--text-primary)]">{roster.total || '—'}</p>
          </GlassPanel>
          <GlassPanel padding="md">
            <p className="text-[11px] text-[var(--text-muted)] mb-1">Active employees</p>
            <p className="text-[22px] font-bold" style={{ color: 'var(--color-success)' }}>{roster.active || '—'}</p>
          </GlassPanel>
          <GlassPanel padding="md">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] text-[var(--text-muted)]">Last sync</p>
              <RefreshCw size={10} className="text-[var(--text-muted)]" />
            </div>
            <p className="text-[12px] font-semibold text-[var(--text-secondary)]">
              {roster.lastSync
                ? formatDistanceToNow(new Date(roster.lastSync), { addSuffix: true })
                : 'Not yet synced'}
            </p>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Auto-syncs every 5 days</p>
          </GlassPanel>
        </div>

        {/* Role breakdown */}
        <GlassPanel padding="md" title="Role distribution">
          <div className="flex flex-wrap gap-3">
            {roleGroups.filter((r) => r.count > 0).map((r) => (
              <div
                key={r.value}
                className="flex items-center gap-2 px-3 py-1.5 rounded-[8px]"
                style={{ background: `${r.color}12`, border: `1px solid ${r.color}25` }}
              >
                <span className="text-[11px] font-bold" style={{ color: r.color }}>{r.label}</span>
                <span
                  className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: `${r.color}25`, color: r.color }}
                >
                  {r.count}
                </span>
              </div>
            ))}
          </div>
        </GlassPanel>

        {/* User list */}
        <GlassPanel padding="md" title={
          <span className="inline-flex items-center gap-1.5">
            <Users size={13} />
            Dashboard users
            {isSuperAdmin && (
              <span className="text-[10px] font-normal text-[var(--text-muted)] ml-1 normal-case tracking-normal">
                — click a role badge to change it
              </span>
            )}
          </span>
        }>
          {loading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 48 }} />
              ))}
            </div>
          ) : profiles.length === 0 ? (
            <p className="text-[13px] text-[var(--text-muted)] text-center py-6">No users yet</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-[10px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}
                >
                  {/* Avatar */}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold"
                    style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
                  >
                    {p.name?.charAt(0).toUpperCase() ?? '?'}
                  </div>

                  {/* Name / email */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                      {p.name}
                      {p.id === self?.id && (
                        <span className="ml-1.5 text-[10px] text-[var(--accent)] font-normal">(you)</span>
                      )}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] truncate">{p.email}</p>
                  </div>

                  {/* Emp ID */}
                  {p.emp_id && (
                    <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0 hidden sm:block">
                      {p.emp_id.toUpperCase()}
                    </span>
                  )}

                  {/* Role */}
                  <div className="shrink-0">
                    {isSuperAdmin ? (
                      <RoleDropdown
                        currentRole={p.role}
                        profileId={p.id}
                        selfId={self!.id}
                        onUpdated={handleRoleUpdate}
                      />
                    ) : (
                      <RolePill role={p.role} />
                    )}
                  </div>

                  {/* Status dot */}
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      background: p.status === 'active'
                        ? 'var(--color-success)'
                        : 'var(--text-muted)',
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </GlassPanel>

        {/* Super-admin info box */}
        {isSuperAdmin && (
          <GlassPanel padding="md">
            <div className="flex items-start gap-3">
              <ShieldCheck size={16} className="text-[var(--accent)] mt-0.5 shrink-0" />
              <div>
                <p className="text-[12px] font-semibold text-[var(--text-primary)] mb-1">
                  Prism Platform employee sync
                </p>
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                  Stores and employees are automatically synced from Prism Platform every 5 days.
                  To trigger an immediate sync, run:
                </p>
                <code
                  className="block mt-2 text-[10px] font-mono px-2.5 py-1.5 rounded-[6px] leading-relaxed"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)', border: '1px solid var(--border-subtle)' }}
                >
                  npx convex run --prod internal.supabaseSync.syncStoresAndEmployees &apos;{'{}'}&apos;
                </code>
              </div>
            </div>
          </GlassPanel>
        )}

        {/* Roster preview (super admin only) */}
        {isSuperAdmin && roster.total > 0 && (
          <GlassPanel padding="md" title={
            <span className="inline-flex items-center gap-1.5">
              <Building2 size={13} />
              Employee roster from Prism Platform
            </span>
          }>
            <RosterTable />
          </GlassPanel>
        )}

      </div>
    </AppShell>
  )
}

function RosterTable() {
  const [rows, setRows] = useState<{
    emp_id: string; name: string; email: string | null;
    department: string | null; store_code: string | null; is_active: boolean
  }[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    supabase
      .from('employee_roster')
      .select('emp_id, name, email, department, store_code, is_active')
      .order('name')
      .limit(50)
      .then(({ data }) => {
        setRows(data ?? [])
        setLoaded(true)
      })
  }, [])

  if (!loaded) return <div className="skeleton" style={{ height: 120 }} />

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[var(--text-muted)] uppercase tracking-[0.06em]">
            <th className="pb-2 pr-4">Emp ID</th>
            <th className="pb-2 pr-4">Name</th>
            <th className="pb-2 pr-4 hidden sm:table-cell">Email</th>
            <th className="pb-2 pr-4 hidden md:table-cell">Dept</th>
            <th className="pb-2 pr-4">Store</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.emp_id}
              className="border-t"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <td className="py-1.5 pr-4 font-mono text-[var(--text-muted)]">{r.emp_id}</td>
              <td className="py-1.5 pr-4 font-semibold text-[var(--text-secondary)]">{r.name}</td>
              <td className="py-1.5 pr-4 text-[var(--text-muted)] hidden sm:table-cell">{r.email ?? '—'}</td>
              <td className="py-1.5 pr-4 text-[var(--text-muted)] hidden md:table-cell">{r.department ?? '—'}</td>
              <td className="py-1.5 pr-4 text-[var(--text-muted)]">{r.store_code ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 50 && (
        <p className="text-[10px] text-[var(--text-muted)] mt-2 text-center">
          Showing first 50 employees
        </p>
      )}
    </div>
  )
}

