'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

interface SidebarCtx {
  collapsed: boolean
  toggle: () => void
  setCollapsed: (v: boolean) => void
  width: number
}

const Ctx = createContext<SidebarCtx>({
  collapsed: false,
  toggle: () => {},
  setCollapsed: () => {},
  width: 248,
})

export const SIDEBAR_WIDTH = 248
export const SIDEBAR_WIDTH_COLLAPSED = 72

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const width = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH
  return (
    <Ctx.Provider value={{ collapsed, toggle: () => setCollapsed((c) => !c), setCollapsed, width }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSidebar() {
  return useContext(Ctx)
}
