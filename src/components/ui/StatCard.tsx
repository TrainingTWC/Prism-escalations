'use client'

import type { ReactNode } from 'react'
import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { cn } from '@/lib/cn'

interface StatCardProps {
  label: string
  value: ReactNode
  subtitle?: string
  icon?: ReactNode
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  /** Override default ember accent (e.g. for semantic emphasis) */
  accent?: string
  className?: string
  /** Index for stagger animation */
  index?: number
}

export function StatCard({
  label,
  value,
  subtitle,
  icon,
  trend,
  trendValue,
  accent,
  className,
  index = 0,
}: StatCardProps) {
  const accentColor = accent ?? 'var(--accent)'
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const trendColor =
    trend === 'up' ? 'var(--color-success)'
    : trend === 'down' ? 'var(--color-danger)'
    : 'var(--text-muted)'

  return (
    <div
      className={cn('widget relative overflow-hidden animate-fadeInUp group', className)}
      style={{
        animationDelay: `${index * 60}ms`,
        padding: '20px 22px 22px',
      }}
    >
      {/* Accent edge */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px] opacity-80 group-hover:opacity-100 transition-opacity"
        style={{ background: `linear-gradient(90deg, ${accentColor}, transparent 80%)` }}
      />
      {/* Ambient glow */}
      <div
        className="absolute -top-12 -right-12 w-36 h-36 rounded-full opacity-[0.08] blur-3xl pointer-events-none group-hover:opacity-[0.14] transition-opacity"
        style={{ background: accentColor }}
      />

      <div className="flex items-start justify-between mb-4 relative">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
          {label}
        </span>
        {icon && (
          <div
            className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0"
            style={{
              background: `${accentColor}1F`,
              color: accentColor,
              border: `1px solid ${accentColor}33`,
            }}
          >
            {icon}
          </div>
        )}
      </div>

      <div
        className="font-mono-value text-[38px] font-extrabold tracking-tight text-[var(--text-primary)] leading-none mb-3 relative"
        style={{ textShadow: `0 0 24px ${accentColor}22` }}
      >
        {value}
      </div>

      <div className="flex items-center justify-between gap-3 relative">
        {subtitle && (
          <span className="text-[11px] text-[var(--text-tertiary)] truncate">{subtitle}</span>
        )}
        {trend && trendValue && (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider shrink-0 px-2 py-1 rounded-md"
            style={{
              color: trendColor,
              background: `${trendColor}14`,
              border: `1px solid ${trendColor}33`,
            }}
          >
            <TrendIcon size={11} />
            {trendValue}
          </span>
        )}
      </div>
    </div>
  )
}
