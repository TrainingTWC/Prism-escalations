'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface PageHeaderProps {
  title: string
  subtitle?: string
  overline?: string
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, overline, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-8 animate-fadeInUp', className)}>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="min-w-0">
          {overline && <div className="text-overline mb-2">{overline}</div>}
          <h1 className="text-[28px] md:text-[32px] font-extrabold tracking-tight text-[var(--text-primary)] leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 text-sm font-normal text-[var(--text-tertiary)] max-w-2xl">
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      <div
        className="mt-6 h-px w-full"
        style={{
          background:
            'linear-gradient(90deg, rgba(224,123,57,0.35) 0%, rgba(224,123,57,0.10) 30%, transparent 100%)',
        }}
      />
    </header>
  )
}
