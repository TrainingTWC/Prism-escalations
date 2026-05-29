'use client'

import Link from 'next/link'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'ghost'

interface BaseProps {
  variant?: Variant
  size?: 'sm' | 'md'
  leading?: ReactNode
  trailing?: ReactNode
  children: ReactNode
  className?: string
}

const SIZE: Record<NonNullable<BaseProps['size']>, string> = {
  sm: 'text-xs px-3 py-1.5',
  md: 'text-sm px-4 py-2',
}

function variantClass(v: Variant) {
  return v === 'primary' ? 'btn-primary' : 'btn-ghost'
}

export function Button({
  variant = 'ghost',
  size = 'md',
  leading,
  trailing,
  children,
  className,
  ...rest
}: BaseProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={cn(variantClass(variant), SIZE[size], className)}>
      {leading}
      {children}
      {trailing}
    </button>
  )
}

interface ButtonLinkProps extends BaseProps {
  href: string
  prefetch?: boolean
  target?: string
}

export function ButtonLink({
  variant = 'ghost',
  size = 'md',
  leading,
  trailing,
  children,
  className,
  href,
  target,
}: ButtonLinkProps) {
  return (
    <Link href={href} target={target} className={cn(variantClass(variant), SIZE[size], className)}>
      {leading}
      {children}
      {trailing}
    </Link>
  )
}
