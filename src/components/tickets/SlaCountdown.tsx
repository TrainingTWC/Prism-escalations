'use client'

import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'

interface SlaCountdownProps {
  deadline: string | null
  compact?: boolean
}

export function SlaCountdown({ deadline, compact = false }: SlaCountdownProps) {
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    if (!deadline) return
    const calc = () => setRemaining(new Date(deadline).getTime() - Date.now())
    calc()
    const id = setInterval(calc, 1000)
    return () => clearInterval(id)
  }, [deadline])

  if (!deadline || remaining === null) {
    return <span className="text-xs text-[var(--text-muted)]">—</span>
  }

  const isBreached = remaining < 0
  const isWarning  = remaining >= 0 && remaining < 30 * 60 * 1000

  const abs = Math.abs(remaining)
  const hours   = Math.floor(abs / 3_600_000)
  const minutes = Math.floor((abs % 3_600_000) / 60_000)
  const seconds = Math.floor((abs % 60_000) / 1_000)

  let label: string
  if (isBreached) {
    label = `+${hours > 0 ? `${hours}h ` : ''}${minutes}m overdue`
  } else if (hours >= 24) {
    const days = Math.floor(hours / 24)
    label = `${days}d ${hours % 24}h left`
  } else if (hours > 0) {
    label = `${hours}h ${minutes}m left`
  } else {
    label = `${minutes}m ${seconds}s left`
  }

  const color = isBreached
    ? 'var(--color-danger)'
    : isWarning
      ? 'var(--color-warning)'
      : 'var(--color-success)'
  const bg = isBreached
    ? 'rgba(239,68,68,0.10)'
    : isWarning
      ? 'rgba(234,179,8,0.10)'
      : 'rgba(34,197,94,0.10)'

  if (compact) {
    return (
      <span
        className={`badge-pill font-mono-value ${isBreached ? 'pulse-breach' : ''}`}
        style={{ color, background: bg, fontSize: 11, fontWeight: 600 }}
      >
        <Clock size={10} />
        {label}
      </span>
    )
  }

  return (
    <div
      className={`flex items-center gap-3 rounded-[12px] px-4 py-3 ${isBreached ? 'pulse-breach' : ''}`}
      style={{ background: bg, border: `1px solid ${color}33` }}
    >
      <Clock size={16} color={color} />
      <div>
        <div
          className="text-[10px] font-bold uppercase tracking-[0.10em]"
          style={{ color }}
        >
          SLA {isBreached ? 'Breached' : isWarning ? 'Critical' : 'Healthy'}
        </div>
        <div
          className="font-mono-value text-lg font-bold tracking-tight leading-tight"
          style={{ color }}
        >
          {label}
        </div>
      </div>
    </div>
  )
}

