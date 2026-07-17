'use client'

import { useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { invalidateCache } from '@/lib/use-cached-query'
import { SidebarProvider, useSidebar } from '@/lib/sidebar-context'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { BottomNav } from './BottomNav'
import { PageHeader } from '@/components/ui/PageHeader'

interface AppShellProps {
  children: ReactNode
  title: string
  subtitle?: string
  overline?: string
  actions?: ReactNode
  /** Hide the in-page header (e.g. when the page renders its own) */
  bare?: boolean
}

export function AppShell(props: AppShellProps) {
  return (
    <SidebarProvider>
      <AppShellInner {...props} />
    </SidebarProvider>
  )
}

function AppShellInner({ children, title, subtitle, overline, actions, bare = false }: AppShellProps) {
  const loadProfile = useAuthStore((state) => state.loadProfile)
  const clearAuth = useAuthStore((state) => state.clear)
  const router = useRouter()
  const { width } = useSidebar()

  useEffect(() => {
    let cancelled = false

    // Cached after the first page — later navigations resolve without a round-trip.
    void loadProfile().then((profile) => {
      if (!cancelled && !profile) router.push('/login')
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        // This path (e.g. session expiry) doesn't reload, so the in-memory
        // query cache would otherwise outlive the session and be served to
        // whoever signs in next.
        invalidateCache()
        clearAuth()
        router.push('/login')
      }
    })
    return () => { cancelled = true; subscription.unsubscribe() }
  }, [loadProfile, clearAuth, router])

  return (
    <div className="relative min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Ambient background */}
      <div className="ambient-blob ambient-blob--tl" />
      <div className="ambient-blob ambient-blob--br" />

      {/* Desktop-only sidebar; phones get the bottom tab bar instead */}
      <Sidebar />

      <div
        className="relative z-10 flex flex-col min-h-screen transition-[padding] duration-300 lg:pl-[var(--shell-pl)]"
        style={{ ['--shell-pl' as string]: `${width}px` }}
      >
        <Topbar />

        {/* pb clears the fixed bottom nav on mobile */}
        <main className="flex-1 w-full px-4 sm:px-6 lg:px-10 py-5 lg:py-8 pb-28 lg:pb-8">
          <div className="max-w-[1400px] mx-auto w-full">
            {!bare && (
              <PageHeader title={title} subtitle={subtitle} overline={overline} actions={actions} />
            )}
            <div className="animate-fadeInUp">{children}</div>
          </div>
        </main>

        <footer
          className="hidden lg:block px-6 lg:px-10 py-5 text-[10px] tracking-[0.18em] uppercase"
          style={{
            color: 'var(--text-secondary)',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary)',
          }}
        >
          <div className="max-w-[1400px] mx-auto flex items-center justify-between flex-wrap gap-2">
            <span>© 2026 Prism Intelligence</span>
            <span className="opacity-70">Operational Platform · v0.1</span>
          </div>
        </footer>
      </div>

      <BottomNav />
    </div>
  )
}


