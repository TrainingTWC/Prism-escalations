'use client'

import { createContext, useContext, type ReactNode } from 'react'

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
  const width = SIDEBAR_WIDTH
  return (
    <Ctx.Provider value={{ collapsed: false, toggle: () => {}, setCollapsed: () => {}, width }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSidebar() {
  return useContext(Ctx)
}
