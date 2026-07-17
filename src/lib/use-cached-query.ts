'use client'

/**
 * Stale-while-revalidate cache for Supabase reads.
 *
 * Every page is a client component that remounts on navigation, so without a
 * cache each page switch drops back to a spinner while it refetches data it
 * already had seconds ago. This keeps results in a module-level cache that
 * outlives unmounts: a revisited page paints from cache on the first frame and
 * refreshes in the background.
 *
 * The cache is in-memory and per-session by design — a reload refetches.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const cache = new Map<string, unknown>()
const inflight = new Map<string, Promise<unknown>>()

/** Bounds memory when a page caches per-filter-combination results. */
const MAX_ENTRIES = 50

function write(key: string, value: unknown) {
  if (!cache.has(key) && cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

/** Drops cached entries whose key starts with `prefix` (all keys if omitted). */
export function invalidateCache(prefix?: string) {
  if (prefix === undefined) {
    cache.clear()
    return
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

export function useCachedQuery<T>(key: string, fetcher: () => Promise<T>) {
  // Held in a ref so an inline fetcher doesn't retrigger on every render —
  // `key` is the sole cache/refetch identity. Synced in an effect declared
  // before the revalidating one, so it is current by the time that fires.
  const fetcherRef = useRef(fetcher)
  const latestKey = useRef(key)
  useEffect(() => {
    fetcherRef.current = fetcher
    latestKey.current = key
  })

  const [data, setData] = useState<T | undefined>(() => cache.get(key) as T | undefined)
  const [loading, setLoading] = useState(() => !cache.has(key))

  // Re-sync from cache when the key changes, using React's documented
  // adjust-state-during-render pattern rather than an effect.
  const [renderedKey, setRenderedKey] = useState(key)
  if (renderedKey !== key) {
    setRenderedKey(key)
    setData(cache.get(key) as T | undefined)
    setLoading(!cache.has(key))
  }

  const revalidate = useCallback(async () => {
    let promise = inflight.get(key) as Promise<T> | undefined
    if (!promise) {
      promise = fetcherRef.current()
      inflight.set(key, promise)
      // Swallowed here only to keep a rejection from going unhandled; the
      // awaiting caller below still sees it.
      void promise.then(
        () => { if (inflight.get(key) === promise) inflight.delete(key) },
        () => { if (inflight.get(key) === promise) inflight.delete(key) },
      )
    }

    try {
      const result = await promise
      write(key, result)
      // The key may have moved on while this was in flight (a filter changed);
      // the result is still worth caching, but it is no longer what's onscreen.
      if (latestKey.current === key) setData(result)
    } catch {
      // Keep showing the last good data rather than blanking the page.
    } finally {
      if (latestKey.current === key) setLoading(false)
    }
  }, [key])

  useEffect(() => {
    void revalidate()
  }, [revalidate])

  /** Applies a local update to cache + state, for optimistic edits. */
  const mutate = useCallback((updater: (current: T | undefined) => T) => {
    setData((current) => {
      const next = updater(current)
      write(key, next)
      return next
    })
  }, [key])

  return { data, loading, revalidate, mutate }
}
