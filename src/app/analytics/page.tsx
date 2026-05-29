'use client'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { BarChart3 } from 'lucide-react'

export default function AnalyticsPage() {
  return (
    <AppShell
      overline="Insights"
      title="Analytics"
      subtitle="MTTR, SLA compliance, reopen rates and operational trends."
    >
      <GlassPanel padding="lg" className="text-center">
        <div
          className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
          style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
        >
          <BarChart3 size={22} />
        </div>
        <p className="text-[15px] font-semibold text-[var(--text-primary)]">Analytics Dashboard</p>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Coming in <span className="text-[var(--accent)] font-semibold">Phase 2</span>
        </p>
      </GlassPanel>
    </AppShell>
  )
}

