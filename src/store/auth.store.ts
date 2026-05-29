'use client'

import { create } from 'zustand'
import { supabase } from '@/lib/supabase/client'
import type { Profile } from '@/lib/supabase/database.types'

interface AuthState {
  profile: Profile | null
  loading: boolean
  setProfile: (profile: Profile | null) => void
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  profile: null,
  loading: true,
  setProfile: (profile) => set({ profile, loading: false }),
  signOut: async () => {
    await supabase.auth.signOut()
    document.cookie = 'prism-auth=; path=/; max-age=0'
    set({ profile: null })
    window.location.href = '/login'
  },

}))
