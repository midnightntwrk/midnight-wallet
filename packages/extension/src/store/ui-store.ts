import { create } from 'zustand'

type Theme = 'light' | 'dark' | 'system'

interface UIState {
  theme: Theme
  isDrawerOpen: boolean
  isDialogOpen: boolean
  dialogContent: React.ReactNode | null
  toast: { message: string; type: 'success' | 'error' | 'info' } | null

  setTheme: (theme: Theme) => void
  openDrawer: () => void
  closeDrawer: () => void
  openDialog: (content: React.ReactNode) => void
  closeDialog: () => void
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
  hideToast: () => void
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'light',
  isDrawerOpen: false,
  isDialogOpen: false,
  dialogContent: null,
  toast: null,

  setTheme: (theme) => set({ theme }),

  openDrawer: () => set({ isDrawerOpen: true }),

  closeDrawer: () => set({ isDrawerOpen: false }),

  openDialog: (content) => set({ isDialogOpen: true, dialogContent: content }),

  closeDialog: () => set({ isDialogOpen: false, dialogContent: null }),

  showToast: (message, type = 'info') => set({ toast: { message, type } }),

  hideToast: () => set({ toast: null }),
}))
