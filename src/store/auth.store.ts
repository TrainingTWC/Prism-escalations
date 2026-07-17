'use client'

import { create } from 'zustand'
import { supabase } from '@/lib/supabase/client'
import type { Profile } from '@/lib/supabase/database.types'

interface AuthState {
  profile: Profile | null
  loading: boolean
  setProfile: (profile: Profile | null) => void
  /**
   * Resolves the signed-in profile, hitting the network only once per session.
   * Subsequent calls (i.e. every page navigation) return the cached profile
   * synchronously. Returns null when there is no authenticated session.
   */
  loadProfile: () => Promise<Profile | null>
  clear: () => void
  signOut: () => Promise<void>
}

/** Dedupes concurrent first-loads (StrictMode double-mount, racing shells). */
let inflight: Promise<Profile | null> | null = null

export const useAuthStore = create<AuthState>((set, get) => ({
  profile: null,
  loading: true,
  setProfile: (profile) => set({ profile, loading: false }),

  loadProfile: async () => {
    const cached = get().profile
    if (cached) return cached
    if (inflight) return inflight

    inflight = (async () => {
      // getSession() reads the persisted session locally; getUser() would round-trip
      // to /auth/v1/user on every call. Supabase refreshes an expired token here.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return null

      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', session.user.id).single()

      return (profile as Profile | null) ?? null
    })()

    try {
      const profile = await inflight
      set({ profile, loading: false })
      return profile
    } finally {
      inflight = null
    }
  },

  clear: () => {
    inflight = null
    set({ profile: null, loading: false })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    document.cookie = 'prism-auth=; path=/; max-age=0'
    inflight = null
    set({ profile: null })
    window.location.href = '/login'
  },
}))
