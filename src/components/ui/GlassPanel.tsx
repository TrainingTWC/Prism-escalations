'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface GlassPanelProps {
  children: ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  variant?: 'glass' | 'widget' | 'solid'
  interactive?: boolean
}

const PADDING: Record<NonNullable<GlassPanelProps['padding']>, string> = {
  none: 'p-0',
  sm:   'p-4',
  md:   'p-6',
  lg:   'p-8',
}

export function GlassPanel({
  children,
  className,
  padding = 'md',
  title,
  subtitle,
  actions,
  variant = 'glass',
  interactive = false,
}: GlassPanelProps) {
  const base =
    variant === 'widget' ? 'widget'
    : variant === 'solid' ? 'bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-[20px]'
    : 'glass'

  return (
    <section
      className={cn(
        base,
        interactive && 'glass-interactive cursor-pointer',
        PADDING[padding],
        className,
      )}
    >
      {(title || actions) && (
        <header className={cn('flex items-start justify-between gap-4', padding === 'none' ? 'px-5 pt-5' : 'mb-4')}>
          <div className="min-w-0">
            {title && (
              <h3 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
                {title}
              </h3>
            )}
            {subtitle && <p className="mt-1 text-xs text-[var(--text-tertiary)]">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
