'use client'

/**
 * Mounted once in the root layout. Wires Capacitor native behaviour:
 *  - status bar + splash screen
 *  - Android hardware back button (history-aware, exits at root)
 *  - `is-native` body class for safe-area padding
 *  - push-notification registration once a user is authenticated
 *
 * Renders nothing and is inert on the web build.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Capacitor } from '@capacitor/core'
import { supabase } from '@/lib/supabase/client'
import { initPushNotifications } from '@/lib/native/push'

export function NativeBridge() {
  const router = useRouter()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let backHandle: { remove: () => void } | undefined
    let authSub: { unsubscribe: () => void } | undefined
    let cancelled = false

    const setup = async () => {
      document.body.classList.add('is-native')

      // Status bar — dark chrome matching the obsidian theme.
      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar')
        await StatusBar.setStyle({ style: Style.Dark })
        if (Capacitor.getPlatform() === 'android') {
          await StatusBar.setBackgroundColor({ color: '#0b0b12' })
        }
      } catch {
        /* ignore */
      }

      // Hide splash once the web layer has painted.
      try {
        const { SplashScreen } = await import('@capacitor/splash-screen')
        await SplashScreen.hide()
      } catch {
        /* ignore */
      }

      // Hardware back button: go back in history, exit when at the root.
      try {
        const { App } = await import('@capacitor/app')
        backHandle = await App.addListener('backButton', ({ canGoBack }) => {
          if (canGoBack || window.history.length > 1) {
            window.history.back()
          } else {
            App.exitApp()
          }
        })
      } catch {
        /* ignore */
      }

      // Register push once we have (or gain) an authenticated session.
      const tryRegister = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (user && !cancelled) {
          await initPushNotifications((path) => router.push(path))
        }
      }
      void tryRegister()

      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') void tryRegister()
      })
      authSub = data.subscription
    }

    void setup()

    return () => {
      cancelled = true
      backHandle?.remove()
      authSub?.unsubscribe()
    }
  }, [router])

  return null
}
