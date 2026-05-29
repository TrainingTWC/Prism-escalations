import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * Service-role Supabase client — bypasses RLS.
 * NEVER import this in client components or pages.
 * Only use in server-side API routes (e.g. webhooks).
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars')
  }

  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
