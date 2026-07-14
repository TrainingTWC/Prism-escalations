'use client'

/**
 * Push-notification registration for the Capacitor Android APK.
 *
 * Flow:
 *  1. Ask for OS notification permission.
 *  2. Register with FCM via the native plugin.
 *  3. Persist the returned device token in Supabase (`device_tokens`) keyed by
 *     the authenticated user, so the `send-push` edge function can target them.
 *  4. Foreground messages are surfaced as local notifications; taps deep-link
 *     into the relevant ticket.
 *
 * All of this is a no-op on the web build.
 */

import { Capacitor } from '@capacitor/core'
import { PushNotifications, type Token } from '@capacitor/push-notifications'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Device } from '@capacitor/device'
import { supabase } from '@/lib/supabase/client'

let initialised = false

type NavigateFn = (path: string) => void

async function persistToken(token: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const info = await Device.getId().catch(() => ({ identifier: 'unknown' }))
    const deviceId = (info as { identifier?: string }).identifier ?? 'unknown'

    await supabase
      .from('device_tokens')
      .upsert(
        {
          user_id: user.id,
          token,
          platform: Capacitor.getPlatform(),
          device_id: deviceId,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: 'token' },
      )
  } catch {
    /* token persistence is best-effort */
  }
}

function deepLinkPath(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null
  if (typeof data.path === 'string') return data.path
  if (typeof data.ticketId === 'string') {
    return `/tickets/view/?id=${encodeURIComponent(data.ticketId)}`
  }
  return null
}

/**
 * Initialise push notifications. Call once after the user is authenticated.
 * `navigate` is used to route when a notification is tapped.
 */
export async function initPushNotifications(navigate: NavigateFn): Promise<void> {
  if (!Capacitor.isNativePlatform() || initialised) return
  initialised = true

  try {
    // Local-notification permission (used to surface foreground pushes).
    await LocalNotifications.requestPermissions().catch(() => undefined)

    let perm = await PushNotifications.checkPermissions()
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions()
    }
    if (perm.receive !== 'granted') return

    await PushNotifications.register()

    await PushNotifications.addListener('registration', (token: Token) => {
      void persistToken(token.value)
    })

    await PushNotifications.addListener('registrationError', () => {
      /* surfaced via Logcat during development */
    })

    // Foreground message -> show a local notification so it is visible in tray.
    await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      const data = notification.data as Record<string, unknown> | undefined
      void LocalNotifications.schedule({
        notifications: [
          {
            id: Math.floor(Math.random() * 2_000_000_000),
            title: notification.title ?? 'Prism Escalations',
            body: notification.body ?? '',
            extra: data,
            smallIcon: 'ic_stat_icon',
          },
        ],
      })
    })

    // Background tap on the push -> deep link.
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const path = deepLinkPath(action.notification.data as Record<string, unknown> | undefined)
      if (path) navigate(path)
    })

    // Tap on a foreground local notification -> deep link.
    await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      const path = deepLinkPath(action.notification.extra as Record<string, unknown> | undefined)
      if (path) navigate(path)
    })
  } catch {
    /* push setup is best-effort; app still works without it */
  }
}
