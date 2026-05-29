'use client'

import type { ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'

interface FilterBarProps {
  children?: ReactNode
  className?: string
  onSearch?: (value: string) => void
  searchValue?: string
  placeholder?: string
  onClear?: () => void
  showClear?: boolean
  trailing?: ReactNode
}

export function FilterBar({
  children,
  className,
  onSearch,
  searchValue = '',
  placeholder = 'Search…',
  onClear,
  showClear,
  trailing,
}: FilterBarProps) {
  return (
    <div className={cn('glass rounded-[16px] p-4 flex flex-wrap items-center gap-3', className)}>
      {onSearch && (
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
          />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={placeholder}
            className="prism-input pl-9"
          />
        </div>
      )}
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      {showClear && (
        <button onClick={onClear} className="btn-ghost" style={{ padding: '7px 12px', fontSize: 12 }}>
          <X size={12} /> Clear
        </button>
      )}
      {trailing && <div className="ml-auto flex items-center gap-3">{trailing}</div>}
    </div>
  )
}

interface FilterItemProps {
  label?: string
  children: ReactNode
}

export function FilterItem({ label, children }: FilterItemProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {label}
        </span>
      )}
      {children}
    </div>
  )
}
