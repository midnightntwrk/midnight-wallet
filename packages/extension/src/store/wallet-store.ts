import { create } from 'zustand'

export interface WalletInfo {
  id: string
  name: string
  createdAt: number
}

export interface Balance {
  shielded: string
  unshielded: string
  dust: string
}

interface WalletState {
  isUnlocked: boolean
  activeWallet: WalletInfo | null
  wallets: WalletInfo[]
  balance: Balance | null
  isLoading: boolean
  error: string | null

  setUnlocked: (unlocked: boolean) => void
  setActiveWallet: (wallet: WalletInfo | null) => void
  setWallets: (wallets: WalletInfo[]) => void
  setBalance: (balance: Balance | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  lock: () => void
  reset: () => void
}

const initialState = {
  isUnlocked: false,
  activeWallet: null,
  wallets: [],
  balance: null,
  isLoading: false,
  error: null,
}

export const useWalletStore = create<WalletState>((set) => ({
  ...initialState,

  setUnlocked: (unlocked) => set({ isUnlocked: unlocked }),

  setActiveWallet: (wallet) => set({ activeWallet: wallet }),

  setWallets: (wallets) => set({ wallets }),

  setBalance: (balance) => set({ balance }),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  lock: () => set({
    isUnlocked: false,
    activeWallet: null,
    balance: null,
    error: null,
  }),

  reset: () => set(initialState),
}))
