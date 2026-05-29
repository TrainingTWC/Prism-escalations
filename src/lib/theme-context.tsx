'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

type Theme = 'dark' | 'light'
type ThemeContextValue = { theme: Theme; toggleTheme: () => void; setTheme: (t: Theme) => void }

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'prism-escalations-theme'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark')

  // Hydrate from localStorage after mount
  useEffect(() => {
    const stored = (typeof window !== 'undefined' && (localStorage.getItem(STORAGE_KEY) as Theme | null)) || 'dark'
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(stored)
  }, [])

  // Reflect theme on <html> class
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(theme)
    try { localStorage.setItem(STORAGE_KEY, theme) } catch {}
  }, [theme])

  const setTheme = useCallback((t: Theme) => setThemeState(t), [])
  const toggleTheme = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), [])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) return { theme: 'dark' as Theme, toggleTheme: () => {}, setTheme: () => {} }
  return ctx
}
