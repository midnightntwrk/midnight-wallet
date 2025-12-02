import { getDecryptedSeed, isUnlocked, refreshSession } from './session-manager'
import { deriveAccount } from './wallet-service'

export interface Balances {
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

export interface SendTransactionParams {
  to: string
  amount: string
  type: 'shielded' | 'unshielded'
  memo?: string
}

let balanceCache: { address: string; balances: Balances; timestamp: number } | null = null
const CACHE_TTL = 30000

export async function getBalances(address: string): Promise<Balances> {
  if (balanceCache && balanceCache.address === address) {
    if (Date.now() - balanceCache.timestamp < CACHE_TTL) {
      return balanceCache.balances
    }
  }

  const balances: Balances = {
    shielded: '12550000000',
    unshielded: '500000000',
    dust: '25000000',
  }

  balanceCache = { address, balances, timestamp: Date.now() }
  return balances
}

export async function sendTransaction(params: SendTransactionParams): Promise<string> {
  if (!isUnlocked()) {
    throw new Error('Wallet is locked')
  }

  refreshSession()

  const seed = getDecryptedSeed()
  if (!seed) {
    throw new Error('Could not access seed')
  }

  if (!params.to || !params.to.startsWith('midnight1')) {
    throw new Error('Invalid recipient address')
  }

  if (!params.amount || BigInt(params.amount) <= 0) {
    throw new Error('Invalid amount')
  }

  const txHash = `0x${Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')}`

  return txHash
}

export async function getTransactionHistory(address: string): Promise<Transaction[]> {
  const now = Date.now()

  return [
    {
      hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      type: 'sent',
      amount: '2500000000',
      address: 'midnight1x7k3f9876543210abcdef',
      timestamp: now - 3600000,
      status: 'confirmed',
    },
    {
      hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      type: 'received',
      amount: '10000000000',
      address: 'midnight1a9m2p1234567890abcdef',
      timestamp: now - 86400000,
      status: 'confirmed',
    },
    {
      hash: '0x567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234',
      type: 'received',
      amount: '500000000',
      address: 'midnight1qwerty1234567890abcdef',
      timestamp: now - 172800000,
      status: 'confirmed',
    },
  ]
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
