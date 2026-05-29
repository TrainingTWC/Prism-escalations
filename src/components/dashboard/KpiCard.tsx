'use client'

import { StatCard } from '@/components/ui/StatCard'

interface KpiCardProps {
  label: string
  value: string | number
  subtext?: string
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  accentColor?: string
  icon?: React.ReactNode
  index?: number
}

/** Backwards-compatible wrapper around the new <StatCard>. */
export function KpiCard({
  label,
  value,
  subtext,
  trend,
  trendValue,
  accentColor,
  icon,
  index = 0,
}: KpiCardProps) {
  return (
    <StatCard
      label={label}
      value={value}
      subtitle={subtext}
      icon={icon}
      trend={trend}
      trendValue={trendValue}
      accent={accentColor}
      index={index}
    />
  )
}

