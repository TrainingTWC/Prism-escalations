import { createClient } from '@supabase/supabase-js'

// Fallbacks prevent build-time crash during static export when secrets aren't set.
// Real values must be provided as NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
// GitHub Secrets so they get baked in at CI build time.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'

export const SUPABASE_URL = supabaseUrl
export const SUPABASE_ANON_KEY = supabaseAnonKey

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
