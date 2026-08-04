'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { Mail, Lock, AlertCircle, ArrowLeft } from 'lucide-react'
import { PrismLogo } from '@/components/ui/PrismLogo'

export default function FirstTimeSetupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)

    const { data, error: fnErr } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
      'self-signup',
      { body: { email: email.trim().toLowerCase(), password } },
    )

    let message = data?.error ?? fnErr?.message
    if (!message && fnErr) {
      const ctx = (fnErr as unknown as { context?: Response }).context
      if (ctx) {
        try { message = (await ctx.json())?.error } catch { /* ignore */ }
      }
    }

    if (message) {
      setError(message)
      setLoading(false)
      return
    }

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (signInErr) {
      // Account was created fine; sign-in hiccup just sends them to the normal login form.
      router.push('/login')
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
        <div className="text-center mb-10">
          <div className="mx-auto mb-5 flex items-center justify-center">
            <PrismLogo size={56} />
          </div>
          <h1 className="text-[28px] font-extrabold tracking-tight text-[var(--text-primary)] leading-none mb-2">
            PRISM <span className="text-gradient-ember">ESCALATIONS</span>
          </h1>
          <p className="text-overline">Operational Intelligence</p>
        </div>

        <div className="glass p-8">
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)] mb-1">
            First-time setup
          </h2>
          <p className="text-[12px] text-[var(--text-muted)] mb-6 leading-relaxed">
            Use your work email. We&apos;ll check it against the active employee roster and set your account up.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2">
                Work email
              </label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@thirdwavecoffee.in"
                  required
                  className="prism-input pl-9"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2">
                Password
              </label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  minLength={8}
                  className="prism-input pl-9"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2">
                Confirm password
              </label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  required
                  minLength={8}
                  className="prism-input pl-9"
                />
              </div>
            </div>

            {error && (
              <div
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)' }}
              >
                <AlertCircle size={14} className="text-[var(--color-danger)] shrink-0" />
                <span className="text-[12px] text-[var(--color-danger)]">{error}</span>
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary mt-2" style={{ width: '100%' }}>
              {loading ? (
                <>
                  <span
                    className="animate-spin-slow inline-block rounded-full"
                    style={{ width: 14, height: 14, border: '2px solid rgba(26,14,5,0.25)', borderTopColor: '#1A0E05' }}
                  />
                  Setting up…
                </>
              ) : (
                'Create account'
              )}
            </button>
          </form>

          <Link
            href="/login"
            className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <ArrowLeft size={12} /> Back to sign in
          </Link>
        </div>

        <p className="text-center mt-6 text-[11px] uppercase tracking-[0.15em] text-[var(--text-muted)]">
          Prism Intelligence · Operational Platform
        </p>
      </div>
    </div>
  )
}
