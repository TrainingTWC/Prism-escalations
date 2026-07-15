'use client'

import { useCallback, useEffect, useState } from 'react'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase/client'
import { pmState, PM_STATE_META, PM_DAYPARTS } from '@/lib/asset-utils'
import { buzzSuccess, tapLight } from '@/lib/native/haptics'
import type { AssetPmTask } from '@/lib/supabase/database.types'
import { formatDistanceToNow } from 'date-fns'
import { Wrench, Plus, X, CheckCircle2, CalendarClock } from 'lucide-react'

interface PmPanelProps {
  assetId: string
  canManage: boolean
  disabled?: boolean   // e.g. asset retired
}

const EMPTY = { title: '', daypart: 'anytime', interval_days: '30' }

export function PmPanel({ assetId, canManage, disabled = false }: PmPanelProps) {
  const [tasks, setTasks] = useState<AssetPmTask[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)

  const fetchTasks = useCallback(async () => {
    const { data } = await supabase
      .from('asset_pm_tasks')
      .select('*')
      .eq('asset_id', assetId)
      .eq('is_active', true)
      .order('next_due_at', { ascending: true, nullsFirst: false })
    setTasks((data as unknown as AssetPmTask[]) || [])
    setLoading(false)
  }, [assetId])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  const markDone = async (task: AssetPmTask) => {
    if (busyId) return
    tapLight()
    setBusyId(task.id)
    const { error } = await supabase.rpc('pm_mark_done', { p_task_id: task.id, p_note: null } as never)
    if (!error) buzzSuccess()
    await fetchTasks()
    setBusyId(null)
  }

  const addTask = async () => {
    if (!form.title.trim() || saving) return
    setSaving(true)
    const interval = form.interval_days ? Number(form.interval_days) : null
    const next_due = interval ? new Date(Date.now() + interval * 86400000).toISOString() : null
    const { error } = await supabase.from('asset_pm_tasks').insert({
      asset_id: assetId,
      title: form.title.trim(),
      daypart: form.daypart,
      interval_days: interval,
      next_due_at: next_due,
    } as never)
    if (!error) {
      setForm({ ...EMPTY })
      setAdding(false)
      await fetchTasks()
    }
    setSaving(false)
  }

  const removeTask = async (id: string) => {
    await supabase.from('asset_pm_tasks').update({ is_active: false } as never).eq('id', id)
    await fetchTasks()
  }

  const labelClass = 'block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-1.5'

  return (
    <GlassPanel
      padding="md"
      title={<span className="inline-flex items-center gap-1.5"><Wrench size={13} /> Preventive Maintenance</span>}
      actions={
        canManage && !disabled ? (
          <button
            onClick={() => setAdding((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)]"
          >
            {adding ? <X size={13} /> : <Plus size={13} />} {adding ? 'Cancel' : 'Add task'}
          </button>
        ) : undefined
      }
    >
      {adding && (
        <div className="mb-4 p-3.5 rounded-[12px]" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--accent-border)' }}>
          <div className="mb-3">
            <label className={labelClass}>Task</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Backwash group head / change water filter"
              className="prism-input"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>When</label>
              <select value={form.daypart} onChange={(e) => setForm((f) => ({ ...f, daypart: e.target.value }))} className="prism-input">
                {PM_DAYPARTS.map((d) => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Every (days)</label>
              <input
                type="number"
                min="1"
                value={form.interval_days}
                onChange={(e) => setForm((f) => ({ ...f, interval_days: e.target.value }))}
                placeholder="blank = one-off"
                className="prism-input"
              />
            </div>
          </div>
          <Button variant="primary" size="sm" disabled={saving || !form.title.trim()} onClick={addTask} className="mt-3">
            {saving ? 'Adding…' : 'Add task'}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 56 }} />)}
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-5">
          <CalendarClock size={26} className="mx-auto mb-2 text-[var(--text-muted)]" />
          <p className="text-[13px] text-[var(--text-secondary)] font-semibold">No maintenance scheduled</p>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            {canManage ? 'Add recurring tasks like cleaning, filter changes or calibration.' : 'Your manager can schedule routine tasks here.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((t) => {
            const state = pmState(t)
            const meta = PM_STATE_META[state]
            return (
              <div
                key={t.id}
                className="flex items-center gap-3 px-3.5 py-3 rounded-[12px]"
                style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-[var(--text-primary)]">{t.title}</span>
                    <span className="badge-pill" style={{ fontSize: 9, color: meta.color, background: meta.bg, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 7px' }}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    {t.daypart !== 'anytime' ? `${t.daypart} · ` : ''}
                    {t.interval_days ? `every ${t.interval_days}d` : 'one-off'}
                    {t.next_due_at ? ` · due ${formatDistanceToNow(new Date(t.next_due_at), { addSuffix: true })}` : ''}
                    {t.last_done_at ? ` · last ${formatDistanceToNow(new Date(t.last_done_at), { addSuffix: true })}` : ''}
                  </p>
                </div>
                {!disabled && (
                  <button
                    disabled={busyId === t.id}
                    onClick={() => markDone(t)}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-[9px] text-[12px] font-bold transition-all disabled:opacity-50"
                    style={{ color: 'var(--color-success)', background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.30)' }}
                  >
                    <CheckCircle2 size={13} /> {busyId === t.id ? '…' : 'Done'}
                  </button>
                )}
                {canManage && (
                  <button
                    aria-label="Remove task"
                    onClick={() => removeTask(t.id)}
                    className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--color-danger)] transition-colors"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </GlassPanel>
  )
}
