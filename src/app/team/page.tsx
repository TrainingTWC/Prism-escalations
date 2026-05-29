'use client'
import { AppShell } from '@/components/layout/AppShell'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Users } from 'lucide-react'

export default function TeamPage() {
  return (
    <AppShell
      overline="People"
      title="Team"
      subtitle="Users, roles and permissions across the escalation hierarchy."
    >
      <GlassPanel padding="lg" className="text-center">
        <div
          className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
          style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
        >
          <Users size={22} />
        </div>
        <p className="text-[15px] font-semibold text-[var(--text-primary)]">Team Management</p>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Coming in <span className="text-[var(--accent)] font-semibold">Phase 2</span>
        </p>
      </GlassPanel>
    </AppShell>
  )
}

