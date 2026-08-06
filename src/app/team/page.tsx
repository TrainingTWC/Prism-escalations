'use client'

import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import {
  Users, ShieldCheck, Building2, RefreshCw, Check, ChevronDown, UserPlus, AlertCircle, CheckCircle2,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

const ROLES = [
  { value: 'store_team',    label: 'Store Team',    color: 'var(--text-muted)' },
  { value: 'store_manager', label: 'Store Manager', color: 'var(--color-success)' },
  { value: 'dept_owner',    label: 'Dept. Owner',   color: '#f59e0b' },
  { value: 'area_manager',  label: 'Area Manager',  color: '#60a5fa' },
  { value: 'auditor',       label: 'Auditor',       color: '#a78bfa' },
  { value: 'leadership',    label: 'Leadership',    color: 'var(--color-warning)' },
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
  store_id: string | null
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

const DEPARTMENTS = ['Operations', 'HR', 'IT', 'SCM', 'QA', 'Finance', 'Maintenance', 'L&D']

/**
 * Scope picker shown to super admins: which store / department / region the
 * user's visibility is tied to, depending on their role. This is what the
 * tickets RLS policies key off.
 */
function ScopeEditor({
  p,
  stores,
  regions,
  onUpdated,
}: {
  p: ProfileRow
  stores: { id: string; store_name: string; store_code: string }[]
  regions: string[]
  onUpdated: (id: string, patch: Partial<ProfileRow>) => void
}) {
  const [saving, setSaving] = useState(false)

  const save = async (patch: Partial<ProfileRow>) => {
    setSaving(true)
    await supabase.from('profiles').update(patch as never).eq('id', p.id)
    onUpdated(p.id, patch)
    setSaving(false)
  }

  const selectStyle = { fontSize: 11, padding: '4px 8px', width: 'auto', maxWidth: 180, opacity: saving ? 0.5 : 1 }

  if (p.role === 'store_team' || p.role === 'store_manager') {
    return (
      <select
        value={p.store_id ?? ''}
        disabled={saving}
        onChange={(e) => save({ store_id: e.target.value || null })}
        className="prism-input"
        style={selectStyle}
      >
        <option value="">No store ⚠</option>
        {stores.map((s) => <option key={s.id} value={s.id}>{s.store_name}</option>)}
      </select>
    )
  }
  if (p.role === 'dept_owner') {
    return (
      <select
        value={p.department ?? ''}
        disabled={saving}
        onChange={(e) => save({ department: e.target.value || null })}
        className="prism-input"
        style={selectStyle}
      >
        <option value="">No department ⚠</option>
        {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
    )
  }
  if (p.role === 'area_manager') {
    return (
      <select
        value={p.region ?? ''}
        disabled={saving}
        onChange={(e) => save({ region: e.target.value || null })}
        className="prism-input"
        style={selectStyle}
      >
        <option value="">No region ⚠</option>
        {regions.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    )
  }
  return null
}

export default function TeamPage() {
  const { profile: self } = useAuthStore()
  const isSuperAdmin = self?.role === 'super_admin'
  const canProvision = isSuperAdmin || self?.role === 'leadership'

  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [stores, setStores] = useState<{ id: string; store_name: string; store_code: string }[]>([])
  const [regions, setRegions] = useState<string[]>([])
  const [roster, setRoster] = useState<RosterStats>({ total: 0, active: 0, lastSync: null })
  const [unprovisioned, setUnprovisioned] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    const [{ data: profs }, { data: rosterData }, { data: storeRows }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('employee_roster').select('is_active, last_synced_at').order('last_synced_at', { ascending: false }).limit(1),
      supabase.from('stores').select('id, store_name, store_code, region').order('store_name'),
    ])

    const profRows = (profs as ProfileRow[]) || []
    setProfiles(profRows)
    const sRows = (storeRows as { id: string; store_name: string; store_code: string; region: string }[] | null) ?? []
    setStores(sRows)
    setRegions(Array.from(new Set(sRows.map((s) => s.region))).sort())

    if (rosterData && rosterData.length > 0) {
      const { count: total } = await supabase.from('employee_roster').select('*', { count: 'exact', head: true })
      const { count: active } = await supabase.from('employee_roster').select('*', { count: 'exact', head: true }).eq('is_active', true)
      setRoster({ total: total ?? 0, active: active ?? 0, lastSync: rosterData[0].last_synced_at })
    }

    // How many active employees still lack an account — drives the provisioning panel.
    if (canProvision) {
      const { data: pending } = await supabase.rpc('unprovisioned_roster_count')
      setUnprovisioned(typeof pending === 'number' ? pending : 0)
    }

    setLoading(false)
  }, [canProvision])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleRoleUpdate = (id: string, role: string) => {
    setProfiles((prev) => prev.map((p) => p.id === id ? { ...p, role } : p))
  }

  const handleScopeUpdate = (id: string, patch: Partial<ProfileRow>) => {
    setProfiles((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p))
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
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Auto-syncs daily at 01:30 IST</p>
          </GlassPanel>
        </div>

        {/* Provision dashboard users from the employee master */}
        {canProvision && (
          <ProvisionPanel pending={unprovisioned} onDone={fetchAll} />
        )}

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

                  {/* Scope (store / department / region, depending on role) */}
                  {isSuperAdmin && (
                    <div className="shrink-0 hidden md:block">
                      <ScopeEditor p={p} stores={stores} regions={regions} onUpdated={handleScopeUpdate} />
                    </div>
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
                  Stores and employees are automatically synced from Prism Platform daily at
                  01:30 IST. To trigger an immediate sync, run:
                </p>
                <code
                  className="block mt-2 text-[10px] font-mono px-2.5 py-1.5 rounded-[6px] leading-relaxed"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)', border: '1px solid var(--border-subtle)' }}
                >
                  npx convex run --prod internal.supabaseRosterSync.syncStoresAndEmployees &apos;{'{}'}&apos;
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

// One invocation of provision-roster-users only creates up to 400 accounts, so
// the first run over a ~2,200-person roster is a loop. This cap is a guard
// against looping forever if the backlog somehow never drains.
const MAX_PROVISION_BATCHES = 20

interface ProvisionResult {
  ok?: boolean
  created?: number
  linked?: number
  failed?: number
  failures?: { email: string; reason: string }[]
  remaining?: number
  departed?: { deactivated: number; reactivated: number } | null
  error?: string
}

function ProvisionPanel({ pending, onDone }: { pending: number | null; onDone: () => Promise<void> }) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [summary, setSummary] = useState('')

  const run = async () => {
    setRunning(true)
    setError('')
    setSummary('')

    let created = 0
    let linked = 0
    let failed = 0
    let firstFailure = ''
    let departed: { deactivated: number; reactivated: number } | null = null

    for (let batch = 0; batch < MAX_PROVISION_BATCHES; batch++) {
      setProgress(created === 0 ? 'Starting…' : `${created} accounts created…`)

      const { data, error: fnErr } = await supabase.functions.invoke<ProvisionResult>(
        'provision-roster-users',
        { body: { limit: 400 } },
      )

      let message = data?.error ?? fnErr?.message
      if (!message && fnErr) {
        const ctx = (fnErr as unknown as { context?: Response }).context
        if (ctx) {
          try { message = (await ctx.json())?.error } catch { /* ignore */ }
        }
      }
      if (message) {
        setError(message)
        setProgress('')
        setRunning(false)
        return
      }

      created += data?.created ?? 0
      linked += data?.linked ?? 0
      failed += data?.failed ?? 0
      if (!firstFailure && data?.failures?.length) {
        firstFailure = `${data.failures[0].email}: ${data.failures[0].reason}`
      }
      if (data?.departed) departed = data.departed

      if (!data?.remaining) break
    }

    const parts = [`${created} account${created === 1 ? '' : 's'} created`]
    if (linked) parts.push(`${linked} existing account${linked === 1 ? '' : 's'} linked to the roster`)
    if (departed?.deactivated) parts.push(`${departed.deactivated} leaver${departed.deactivated === 1 ? '' : 's'} deactivated`)
    if (departed?.reactivated) parts.push(`${departed.reactivated} rejoiner${departed.reactivated === 1 ? '' : 's'} reactivated`)
    if (failed) parts.push(`${failed} failed${firstFailure ? ` (first: ${firstFailure})` : ''}`)

    setSummary(`${parts.join(' · ')}. No emails were sent.`)
    setProgress('')
    setRunning(false)
    await onDone()
  }

  return (
    <GlassPanel padding="md" title={
      <span className="inline-flex items-center gap-1.5">
        <UserPlus size={13} /> Provision dashboard users
      </span>
    }>
      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed mb-3">
        Every active employee on the master gets a dashboard account, so they can be picked as
        a ticket owner before they&apos;ve ever opened the app. Accounts are created silently —
        no invitation, no password, <strong className="text-[var(--text-secondary)]">no email of any kind</strong>.
        People get in via Prism Platform SSO, or by setting a password at
        <code className="mx-1 text-[10px] font-mono px-1 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)' }}>/login/setup</code>.
        Everyone lands as Store Team; raise anyone&apos;s role below.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={run} disabled={running || pending === 0} className="justify-center">
          <UserPlus size={14} />
          {running ? (progress || 'Provisioning…') : 'Provision now'}
        </Button>
        <span className="text-[11px] text-[var(--text-muted)]">
          {pending === null
            ? '—'
            : pending === 0
              ? 'Everyone on the active roster already has an account.'
              : `${pending} active employee${pending === 1 ? '' : 's'} without an account.`}
        </span>
      </div>

      <p className="text-[10px] text-[var(--text-muted)] mt-2.5">
        Runs automatically every night at 02:15 IST, after the roster sync — this button is only
        for the initial backfill or when you don&apos;t want to wait.
      </p>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg mt-3"
             style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)' }}>
          <AlertCircle size={13} className="text-[var(--color-danger)] shrink-0 mt-0.5" />
          <span className="text-[11px] text-[var(--color-danger)]">{error}</span>
        </div>
      )}
      {summary && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg mt-3"
             style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
          <CheckCircle2 size={13} style={{ color: 'var(--color-success)' }} className="shrink-0 mt-0.5" />
          <span className="text-[11px] text-[var(--text-secondary)]">{summary}</span>
        </div>
      )}
    </GlassPanel>
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

