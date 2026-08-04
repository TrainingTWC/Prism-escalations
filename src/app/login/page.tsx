'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { Mail, Lock, AlertCircle } from 'lucide-react'
import { PrismLogo } from '@/components/ui/PrismLogo'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    document.cookie = 'prism-auth=1; path=/; max-age=604800; SameSite=Lax'
    router.push('/')
  }

  return (
    <div
      className="relative min-h-screen flex items-center justify-center px-6 overflow-hidden"
      style={{ background: 'var(--bg-primary)' }}
    >
      <div className="ambient-blob ambient-blob--tl" />
      <div className="ambient-blob ambient-blob--br" />

      <div className="relative z-10 w-full max-w-[420px] animate-fadeInUp">
        {/* Brand */}
        <div className="text-center mb-10">
          <div className="mx-auto mb-5 flex items-center justify-center">
            <PrismLogo size={56} />
          </div>
          <h1 className="text-[28px] font-extrabold tracking-tight text-[var(--text-primary)] leading-none mb-2">
            PRISM <span className="text-gradient-ember">ESCALATIONS</span>
          </h1>
          <p className="text-overline">Operational Intelligence</p>
        </div>

        {/* Card */}
        <div className="glass p-8">
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)] mb-6">
            Sign in to your account
          </h2>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            {/* Email */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2">
                Email
              </label>
              <div className="relative">
                <Mail
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  className="prism-input pl-9"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2">
                Password
              </label>
              <div className="relative">
                <Lock
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="prism-input pl-9"
                />
              </div>
            </div>

            {error && (
              <div
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg"
                style={{
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.20)',
                }}
              >
                <AlertCircle size={14} className="text-[var(--color-danger)] shrink-0" />
                <span className="text-[12px] text-[var(--color-danger)]">{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary mt-2"
              style={{ width: '100%' }}
            >
              {loading ? (
                <>
                  <span
                    className="animate-spin-slow inline-block rounded-full"
                    style={{
                      width: 14,
                      height: 14,
                      border: '2px solid rgba(26,14,5,0.25)',
                      borderTopColor: '#1A0E05',
                    }}
                  />
                  Signing in…
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <Link
            href="/login/setup"
            className="mt-5 block text-center text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            First time here? Set up your account
          </Link>

          <a
            href="https://app.prismintelligence.in/login?redirect_uri=https%3A%2F%2Fescalations.prismintelligence.in%2Fsso%2Fcallback&app=escalations"
            className="mt-3 block text-center text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            Sign in with Prism
          </a>
        </div>

        <p className="text-center mt-6 text-[11px] uppercase tracking-[0.15em] text-[var(--text-muted)]">
          Prism Intelligence · Operational Platform
        </p>
      </div>
    </div>
  )
}

