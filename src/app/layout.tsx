import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/lib/theme-context'
import { NativeBridge } from '@/components/native/NativeBridge'

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jb',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
})

export const metadata: Metadata = {
  title: 'Prism Escalations',
  description:
    'Unified Operational Issue Management System. Track tickets, SLAs, escalations and operational risk across your retail network.',
  keywords:
    'escalation management, SLA tracking, operational intelligence, retail operations, issue management',
}

// Native-app feel: fixed scale, no user zoom, safe-area aware, dark theme chrome.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0b0b12',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={jetbrainsMono.variable}>
      <head>
        <link rel="icon" href="/prism-logo.png" type="image/png" />
        <link rel="shortcut icon" href="/prism-logo.png" type="image/png" />
        <link rel="apple-touch-icon" href="/prism-logo.png" />
        {/* Restore deep-link path saved by 404.html SPA redirect before React hydrates */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){var r=sessionStorage.getItem('spa_redirect');if(r){sessionStorage.removeItem('spa_redirect');history.replaceState(null,'',r);}})();` }} />
      </head>
      <body suppressHydrationWarning className={`${jetbrainsMono.className} antialiased`}>
        <ThemeProvider>{children}</ThemeProvider>
        <NativeBridge />
      </body>
    </html>
  )
}
