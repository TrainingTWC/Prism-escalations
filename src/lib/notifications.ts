'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase/client'

export type NotifKind = 'sla_breach' | 'sla_soon' | 'recurring' | 'auto' | 'new'

export interface NotifItem {
  id: string
  kind: NotifKind
  title: string
  body: string
  ticketId: string
  ticketCode: string | null
  severity: string | null
  ts: number
}

interface NotifState {
  readIds: string[]
  deletedIds: string[]
}

const STORAGE_KEY = 'prism-notifications-state-v1'

function loadState(): NotifState {
  if (typeof window === 'undefined') return { readIds: [], deletedIds: [] }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { readIds: [], deletedIds: [] }
    const parsed = JSON.parse(raw) as Partial<NotifState>
    return { readIds: parsed.readIds ?? [], deletedIds: parsed.deletedIds ?? [] }
  } catch {
    return { readIds: [], deletedIds: [] }
  }
}

function saveState(state: NotifState) {
  if (typeof window === 'undefined') return
  // keep the lists from growing unbounded
  const trim = (a: string[]) => a.slice(-400)
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ readIds: trim(state.readIds), deletedIds: trim(state.deletedIds) }),
  )
}

interface TicketRow {
  id: string
  ticket_code: string | null
  title: string
  severity: string | null
  status: string | null
  sla_deadline: string | null
  created_at: string
  intelligence_source: boolean | null
  intelligence_pattern_flag: boolean | null
  store: { store_name: string | null } | null
}

const ACTIVE = ['open', 'in_progress', 'resolved']

function deriveNotifications(rows: TicketRow[]): NotifItem[] {
  const now = Date.now()
  const items: NotifItem[] = []

  for (const t of rows) {
    const store = t.store?.store_name ? ` · ${t.store.store_name}` : ''
    const deadline = t.sla_deadline ? new Date(t.sla_deadline).getTime() : null
    const isActive = t.status ? ACTIVE.includes(t.status) : false

    let kind: NotifKind
    let title: string
    let body: string
    let ts = new Date(t.created_at).getTime()

    if (isActive && deadline != null && deadline < now) {
      kind = 'sla_breach'
      title = 'SLA breached'
      body = `${t.title}${store}`
      ts = deadline
    } else if (isActive && deadline != null && deadline - now < 60 * 60 * 1000 && deadline > now) {
      kind = 'sla_soon'
      title = 'SLA due within the hour'
      body = `${t.title}${store}`
      ts = deadline - 60 * 60 * 1000
    } else if (t.intelligence_pattern_flag) {
      kind = 'recurring'
      title = 'Recurring issue detected'
      body = `${t.title}${store}`
    } else if (t.intelligence_source) {
      kind = 'auto'
      title = 'Auto-generated from audit'
      body = `${t.title}${store}`
    } else {
      kind = 'new'
      title = 'New ticket raised'
      body = `${t.title}${store}`
    }

    items.push({
      id: `${kind}:${t.id}`,
      kind,
      title,
      body,
      ticketId: t.id,
      ticketCode: t.ticket_code,
      severity: t.severity,
      ts,
    })
  }

  return items.sort((a, b) => b.ts - a.ts)
}

export function useNotifications() {
  const [raw, setRaw] = useState<NotifItem[]>([])
  const [state, setState] = useState<NotifState>({ readIds: [], deletedIds: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setState(loadState())
  }, [])

  const fetchNotifications = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('tickets')
        .select('id, ticket_code, title, severity, status, sla_deadline, created_at, intelligence_source, intelligence_pattern_flag, store:stores(store_name)')
        .order('created_at', { ascending: false })
        .limit(60)
      if (error) throw error
      setRaw(deriveNotifications((data ?? []) as unknown as TicketRow[]))
    } catch {
      setRaw([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchNotifications()
    const channel = supabase
      .channel('notif-tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => fetchNotifications())
      .subscribe()
    const interval = setInterval(fetchNotifications, 60_000)
    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [fetchNotifications])

  const deletedSet = useMemo(() => new Set(state.deletedIds), [state.deletedIds])
  const readSet = useMemo(() => new Set(state.readIds), [state.readIds])

  const items = useMemo(
    () => raw.filter((n) => !deletedSet.has(n.id)).map((n) => ({ ...n, read: readSet.has(n.id) })),
    [raw, deletedSet, readSet],
  )

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items])

  const markAllRead = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, readIds: Array.from(new Set([...prev.readIds, ...raw.map((n) => n.id)])) }
      saveState(next)
      return next
    })
  }, [raw])

  const markRead = useCallback((id: string) => {
    setState((prev) => {
      if (prev.readIds.includes(id)) return prev
      const next = { ...prev, readIds: [...prev.readIds, id] }
      saveState(next)
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setState((prev) => {
      const next = { ...prev, deletedIds: Array.from(new Set([...prev.deletedIds, id])) }
      saveState(next)
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, deletedIds: Array.from(new Set([...prev.deletedIds, ...raw.map((n) => n.id)])) }
      saveState(next)
      return next
    })
  }, [raw])

  return { items, unreadCount, loading, markAllRead, markRead, remove, clearAll }
}
