import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { sendMessage } from '@/lib/background'

export type NetworkType = 'mainnet' | 'testnet'
export type CurrencyType = 'USD' | 'EUR' | 'GBP'

export interface NetworkConfig {
  id: NetworkType
  name: string
  indexerUrl: string
  proverUrl: string
  nodeUrl: string
}

export const NETWORKS: Record<NetworkType, NetworkConfig> = {
  mainnet: {
    id: 'mainnet',
    name: 'Mainnet',
    indexerUrl: 'https://indexer.midnight.network',
    proverUrl: 'https://prover.midnight.network',
    nodeUrl: 'https://node.midnight.network',
  },
  testnet: {
    id: 'testnet',
    name: 'Testnet',
    indexerUrl: 'https://indexer.testnet.midnight.network',
    proverUrl: 'https://prover.testnet.midnight.network',
    nodeUrl: 'https://node.testnet.midnight.network',
  },
}

export const AUTO_LOCK_OPTIONS = [
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
]

interface SettingsState {
  network: NetworkType
  autoLockMinutes: number
  currency: CurrencyType

  setNetwork: (network: NetworkType) => void
  setAutoLock: (minutes: number) => void
  setCurrency: (currency: CurrencyType) => void
  getNetworkConfig: () => NetworkConfig
  syncAutoLockToBackend: (minutes: number) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      network: 'testnet',
      autoLockMinutes: 15,
      currency: 'USD',

      setNetwork: (network) => set({ network }),

      setAutoLock: (autoLockMinutes) => {
        set({ autoLockMinutes })
        get().syncAutoLockToBackend(autoLockMinutes)
      },

      setCurrency: (currency) => set({ currency }),

      getNetworkConfig: () => NETWORKS[get().network],

      syncAutoLockToBackend: (minutes) => {
        sendMessage('SET_AUTO_LOCK', { minutes }).catch(() => {
        })
      },
    }),
    {
      name: 'midnight-settings',
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.syncAutoLockToBackend(state.autoLockMinutes)
        }
      },
    }
  )
)
