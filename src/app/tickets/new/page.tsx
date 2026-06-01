'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button, ButtonLink } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { CATEGORIES, getSlaDeadline } from '@/lib/ticket-utils'
import type { Store } from '@/lib/supabase/database.types'
import { mapDepartment } from '@/lib/intelligence/department-map'
import { ArrowLeft, Ticket, AlertCircle } from 'lucide-react'

type Severity = 'critical' | 'high' | 'medium' | 'low'

const SEVERITY_OPTIONS: { value: Severity; label: string; desc: string; color: string }[] = [
  { value: 'critical', label: 'Critical', desc: '30 min SLA', color: 'var(--color-danger)' },
  { value: 'high',     label: 'High',     desc: '2 hr SLA',  color: 'var(--color-warning)' },
  { value: 'medium',   label: 'Medium',   desc: '24 hr SLA', color: 'var(--color-info)' },
  { value: 'low',      label: 'Low',      desc: '72 hr SLA', color: 'var(--text-tertiary)' },
]

export default function NewTicketPage() {
  const router = useRouter()
  const { profile } = useAuthStore()
  const [stores, setStores] = useState<Store[]>([])
  const [employees, setEmployees] = useState<{ id: string; name: string; department: string | null; role: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Operations' as keyof typeof CATEGORIES,
    sub_category: '',
    severity: 'medium' as Severity,
    store_id: '',
    assigned_to: '',
    source_type: 'store' as 'audit' | 'store' | 'am' | 'leadership',
  })

  useEffect(() => {
    supabase.from('stores').select('*').order('store_name').then(({ data }) => {
      setStores(data || [])
      if (profile?.store_id) setForm((f) => ({ ...f, store_id: profile.store_id! }))
    })
    supabase
      .from('profiles')
      .select('id, name, department, role')
      .eq('status', 'active')
      .order('name')
      .then(({ data }) => setEmployees(data || []))
  }, [profile])

  const subcategories = CATEGORIES[form.category] || []

  const filteredEmployees = employees.filter((emp) => {
    if (!emp.department) return false
    const mapped = mapDepartment(emp.department)
    if (mapped === form.category) return true
    return emp.department.toLowerCase().includes(form.category.toLowerCase())
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile) return
    setLoading(true)
    setError('')

    const ticket_code = `TKT-${Date.now().toString(36).toUpperCase()}`
    const sla_deadline = getSlaDeadline(form.severity, new Date().toISOString()).toISOString()

    const { error: insertError } = await supabase.from('tickets').insert({
      ...form,
      assigned_to: form.assigned_to || null,
      ticket_code,
      sla_deadline,
      raised_by: profile.id,
      status: 'open',
    } as never)

    if (insertError) {
      setError(insertError.message)
      setLoading(false)
      return
    }

    router.push('/tickets')
  }

  const labelClass = 'block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2'

  return (
    <AppShell
      overline="New Issue"
      title="Create Ticket"
      subtitle="Report an operational issue and route it through the escalation engine."
    >
      <div className="max-w-[680px]">
        <Link
          href="/tickets"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-6"
        >
          <ArrowLeft size={12} /> Back to tickets
        </Link>

        <GlassPanel padding="lg">
          <div className="flex items-center gap-3 mb-7">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
            >
              <Ticket size={16} />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Issue Details</h2>
              <p className="text-xs text-[var(--text-muted)]">All fields marked * are required</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {/* Title */}
            <div>
              <label className={labelClass}>Issue Title *</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Brief description of the issue"
                required
                className="prism-input"
              />
            </div>

            {/* Category / sub */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Category *</label>
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      category: e.target.value as keyof typeof CATEGORIES,
                      sub_category: '',
                      assigned_to: '',
                    }))
                  }
                  required
                  className="prism-input"
                >
                  {Object.keys(CATEGORIES).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Sub-category</label>
                <select
                  value={form.sub_category}
                  onChange={(e) => setForm((f) => ({ ...f, sub_category: e.target.value }))}
                  className="prism-input"
                >
                  <option value="">Select…</option>
                  {subcategories.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {/* Severity */}
            <div>
              <label className={labelClass}>Severity *</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {SEVERITY_OPTIONS.map(({ value, label, desc, color }) => {
                  const selected = form.severity === value
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, severity: value }))}
                      className="rounded-[10px] px-3 py-3 text-center transition-all"
                      style={{
                        background: selected ? `${color}1A` : 'var(--bg-tertiary)',
                        border: `1px solid ${selected ? color : 'var(--border-subtle)'}`,
                        boxShadow: selected ? `0 0 0 3px ${color}1A` : undefined,
                      }}
                    >
                      <div
                        className="text-[13px] font-semibold"
                        style={{ color: selected ? color : 'var(--text-secondary)' }}
                      >
                        {label}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Store */}
            <div>
              <label className={labelClass}>Store *</label>
              <select
                value={form.store_id}
                onChange={(e) => setForm((f) => ({ ...f, store_id: e.target.value }))}
                required
                className="prism-input"
              >
                <option value="">Select store…</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>
                ))}
              </select>
            </div>

            {/* Assigned To */}
            <div>
              <label className={labelClass}>Assigned To</label>
              <select
                value={form.assigned_to}
                onChange={(e) => setForm((f) => ({ ...f, assigned_to: e.target.value }))}
                className="prism-input"
              >
                <option value="">Unassigned</option>
                {filteredEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
              {filteredEmployees.length === 0 && (
                <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                  No active {form.category} staff found
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className={labelClass}>Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Describe the issue in detail…"
                rows={4}
                className="prism-input"
                style={{ resize: 'vertical' }}
              />
            </div>

            {error && (
              <div
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg"
                style={{
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.20)',
                }}
              >
                <AlertCircle size={14} className="text-[var(--color-danger)] shrink-0" />
                <span className="text-[12px] text-[var(--color-danger)]">{error}</span>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <Button type="submit" disabled={loading} variant="primary" className="flex-1 justify-center">
                {loading ? 'Creating…' : 'Create Ticket'}
              </Button>
              <ButtonLink href="/tickets" variant="ghost">Cancel</ButtonLink>
            </div>
          </form>
        </GlassPanel>
      </div>
    </AppShell>
  )
}
