import { getDecryptedSeed, isUnlocked, refreshSession } from './session-manager'
import { deriveAccount } from './wallet-service'
import { checkIndexerConnection } from './indexer-client'

export interface Balances {
  shielded: string
  unshielded: string
  dust: string
  synced: boolean
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

export interface SendTransactionParams {
  to: string
  amount: string
  type: 'shielded' | 'unshielded'
  memo?: string
}

let balanceCache: { address: string; balances: Balances; timestamp: number } | null = null
const CACHE_TTL = 30000

let lastSendTimestamp = 0
const SEND_RATE_LIMIT_MS = 2000

export async function getBalances(address: string): Promise<Balances> {
  if (balanceCache && balanceCache.address === address) {
    if (Date.now() - balanceCache.timestamp < CACHE_TTL) {
      return balanceCache.balances
    }
  }

  const isConnected = await checkIndexerConnection()

  const balances: Balances = {
    shielded: '0',
    unshielded: '0',
    dust: '0',
    synced: false,
  }

  if (!isConnected) {
    return balances
  }

  balanceCache = { address, balances, timestamp: Date.now() }
  return balances
}

export async function sendTransaction(params: SendTransactionParams): Promise<string> {
  const now = Date.now()
  if (now - lastSendTimestamp < SEND_RATE_LIMIT_MS) {
    throw new Error('Please wait before sending another transaction')
  }

  if (!isUnlocked()) {
    throw new Error('Wallet is locked')
  }

  refreshSession()

  const seed = getDecryptedSeed()
  if (!seed) {
    throw new Error('Could not access seed')
  }

  if (!params.to || !params.to.startsWith('mn_dust_')) {
    throw new Error('Invalid recipient address')
  }

  if (!params.amount || BigInt(params.amount) <= 0) {
    throw new Error('Invalid amount')
  }

  lastSendTimestamp = now

  const txHash = `0x${Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')}`

  clearBalanceCache()

  return txHash
}

export async function getTransactionHistory(_address: string): Promise<Transaction[]> {
  return []
}

export async function getCurrentAddress(): Promise<string> {
  if (!isUnlocked()) {
    throw new Error('Wallet is locked')
  }

  refreshSession()

  const seed = getDecryptedSeed()
  if (!seed) {
    throw new Error('Could not access seed')
  }

  const { address } = await deriveAccount(seed, 0)
  return address
}

export function clearBalanceCache(): void {
  balanceCache = null
}
