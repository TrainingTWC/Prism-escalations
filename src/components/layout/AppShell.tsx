'use client'

import { useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/store/auth.store'
import { SidebarProvider, useSidebar } from '@/lib/sidebar-context'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
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
  const { setProfile } = useAuthStore()
  const router = useRouter()
  const { width } = useSidebar()

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', user.id).single()

      setProfile(profile)
    }
    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.push('/login')
    })
    return () => subscription.unsubscribe()
  }, [setProfile, router])

  return (
    <div className="relative min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Ambient background */}
      <div className="ambient-blob ambient-blob--tl" />
      <div className="ambient-blob ambient-blob--br" />

      <Sidebar />

      <div
        className="relative z-10 flex flex-col min-h-screen transition-[padding] duration-300"
        style={{ paddingLeft: width }}
      >
        <Topbar />

        <main className="flex-1 w-full px-6 lg:px-10 py-8">
          <div className="max-w-[1400px] mx-auto w-full">
            {!bare && (
              <PageHeader title={title} subtitle={subtitle} overline={overline} actions={actions} />
            )}
            <div className="animate-fadeInUp">{children}</div>
          </div>
        </main>

        <footer
          className="px-6 lg:px-10 py-5 text-[10px] tracking-[0.18em] uppercase"
          style={{
            color: 'var(--text-muted)',
            borderTop: '1px solid var(--border-subtle)',
            background: 'rgba(9,9,11,0.4)',
          }}
        >
          <div className="max-w-[1400px] mx-auto flex items-center justify-between flex-wrap gap-2">
            <span className="opacity-80">© 2026 Prism Intelligence</span>
            <span className="opacity-60">Operational Platform · v0.1</span>
          </div>
        </footer>
      </div>
    </div>
  )
}


