'use client'

/**
 * Blocks page zoom on desktop.
 *
 * The `viewport` meta in the root layout (userScalable: false) only governs
 * touch pinch-zoom on mobile. Desktop browsers ignore it entirely and expose
 * trackpad pinch as either a ctrl-modified wheel event (Chrome/Edge/Firefox)
 * or WebKit's non-standard gesture* events (Safari) — both must be cancelled
 * explicitly, and both need passive:false or preventDefault is a no-op.
 */

import { useEffect } from 'react'

export function ZoomGuard() {
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) event.preventDefault()
    }
    const onGesture = (event: Event) => event.preventDefault()

    const opts: AddEventListenerOptions = { passive: false }
    window.addEventListener('wheel', onWheel, opts)
    window.addEventListener('gesturestart', onGesture, opts)
    window.addEventListener('gesturechange', onGesture, opts)
    window.addEventListener('gestureend', onGesture, opts)

    return () => {
      window.removeEventListener('wheel', onWheel, opts)
      window.removeEventListener('gesturestart', onGesture, opts)
      window.removeEventListener('gesturechange', onGesture, opts)
      window.removeEventListener('gestureend', onGesture, opts)
    }
  }, [])

  return null
}
