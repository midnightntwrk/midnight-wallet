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

export interface Transaction {
  hash: string
  type: 'sent' | 'received'
  amount: string
  address: string
  timestamp: number
  status: 'pending' | 'confirmed' | 'failed'
  memo?: string
}

interface WalletState {
  isUnlocked: boolean
  activeWallet: WalletInfo | null
  wallets: WalletInfo[]
  balance: Balance | null
  transactions: Transaction[]
  address: string | null
  isLoading: boolean
  isSending: boolean
  error: string | null

  setUnlocked: (unlocked: boolean) => void
  setActiveWallet: (wallet: WalletInfo | null) => void
  setWallets: (wallets: WalletInfo[]) => void
  setBalance: (balance: Balance | null) => void
  setTransactions: (transactions: Transaction[]) => void
  setAddress: (address: string | null) => void
  setLoading: (loading: boolean) => void
  setSending: (sending: boolean) => void
  setError: (error: string | null) => void
  lock: () => void
  reset: () => void
}

const initialState = {
  isUnlocked: false,
  activeWallet: null,
  wallets: [],
  balance: null,
  transactions: [],
  address: null,
  isLoading: false,
  isSending: false,
  error: null,
}

export const useWalletStore = create<WalletState>((set) => ({
  ...initialState,

  setUnlocked: (unlocked) => set({ isUnlocked: unlocked }),

  setActiveWallet: (wallet) => set({ activeWallet: wallet }),

  setWallets: (wallets) => set({ wallets }),

  setBalance: (balance) => set({ balance }),

  setTransactions: (transactions) => set({ transactions }),

  setAddress: (address) => set({ address }),

  setLoading: (loading) => set({ isLoading: loading }),

  setSending: (sending) => set({ isSending: sending }),

  setError: (error) => set({ error }),

  lock: () => set({
    isUnlocked: false,
    activeWallet: null,
    balance: null,
    transactions: [],
    address: null,
    error: null,
  }),

  reset: () => set(initialState),
}))
