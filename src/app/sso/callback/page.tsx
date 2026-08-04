'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { PrismLogo } from '@/components/ui/PrismLogo'
import { AlertCircle } from 'lucide-react'

// Landed here from prism-platform's /login?redirect_uri=<this>&app=escalations
// with the session token in the URL fragment (never sent to any server as
// part of the URL — only over the authenticated sso-login call below).
export default function SsoCallbackPage() {
  return (
    <Suspense fallback={<SsoStatus />}>
      <SsoCallbackInner />
    </Suspense>
  )
}

function SsoCallbackInner() {
  const router = useRouter()
  const [error, setError] = useState('')

  useEffect(() => {
    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash)
    const token = params.get('token')
    if (!token) {
      setError('No sign-in token was provided.')
      return
    }
    // Clear the fragment immediately so the token doesn't linger in history.
    window.history.replaceState(null, '', window.location.pathname)

    ;(async () => {
      const { data, error: fnError } = await supabase.functions.invoke<{
        token_hash: string
        email: string
      }>('sso-login', { body: { token } })

      if (fnError || !data) {
        setError(fnError?.message ?? 'Sign-in failed. Try again.')
        return
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        type: 'magiclink',
        token_hash: data.token_hash,
        email: data.email,
      })
      if (verifyError) {
        setError(verifyError.message)
        return
      }

      document.cookie = 'prism-auth=1; path=/; max-age=604800; SameSite=Lax'
      router.push('/')
    })()
  }, [router])

  if (!error) return <SsoStatus />

  return (
    <div
      className="relative min-h-screen flex items-center justify-center px-6"
      style={{ background: 'var(--bg-primary)' }}
    >
      <div className="glass p-8 max-w-[420px] w-full text-center">
        <AlertCircle size={20} className="mx-auto mb-3 text-[var(--color-danger)]" />
        <p className="text-[13px] text-[var(--color-danger)] mb-4">{error}</p>
        <a href="/login" className="text-[12px] text-[var(--text-secondary)] hover:underline">
          Back to sign in
        </a>
      </div>
    </div>
  )
}

function SsoStatus() {
  return (
    <div
      className="relative min-h-screen flex items-center justify-center px-6"
      style={{ background: 'var(--bg-primary)' }}
    >
      <div className="text-center">
        <PrismLogo size={48} />
        <p className="mt-4 text-[12px] text-[var(--text-muted)]">Signing you in…</p>
      </div>
    </div>
  )
}
