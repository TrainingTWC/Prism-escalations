'use client'

/**
 * Thin, web-safe wrappers around Capacitor native APIs.
 *
 * Every helper is a no-op (or graceful fallback) when running in a normal
 * browser, so the same code powers both the GitHub Pages web build and the
 * Capacitor-wrapped Android APK. Plugin methods are only invoked when
 * `Capacitor.isNativePlatform()` is true.
 */

import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'

export const isNative = (): boolean => Capacitor.isNativePlatform()
export const nativePlatform = (): string => Capacitor.getPlatform()

/** Light tap — use for button presses, toggles, selections. */
export async function tapLight(): Promise<void> {
  if (!isNative()) {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(10)
    return
  }
  try {
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch {
    /* ignore */
  }
}

/** Medium tap — use for confirmations, submitting forms. */
export async function tapMedium(): Promise<void> {
  if (!isNative()) {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(20)
    return
  }
  try {
    await Haptics.impact({ style: ImpactStyle.Medium })
  } catch {
    /* ignore */
  }
}

/** Success buzz — order completed, ticket resolved, etc. */
export async function buzzSuccess(): Promise<void> {
  if (!isNative()) {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate([15, 40, 15])
    return
  }
  try {
    await Haptics.notification({ type: NotificationType.Success })
  } catch {
    /* ignore */
  }
}

/** Warning / error buzz — SLA breach, validation error. */
export async function buzzWarning(): Promise<void> {
  if (!isNative()) {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate([30, 60, 30])
    return
  }
  try {
    await Haptics.notification({ type: NotificationType.Warning })
  } catch {
    /* ignore */
  }
}
