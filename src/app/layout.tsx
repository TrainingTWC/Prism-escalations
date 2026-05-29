import type { Metadata } from 'next'
import { JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/lib/theme-context'

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jb',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
})

export const metadata: Metadata = {
  title: 'Prism Escalations — Operational Intelligence',
  description:
    'Unified Operational Issue Management System. Track tickets, SLAs, escalations and operational risk across your retail network.',
  keywords:
    'escalation management, SLA tracking, operational intelligence, retail operations, issue management',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={jetbrainsMono.variable}>
      <body suppressHydrationWarning className={`${jetbrainsMono.className} antialiased`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
