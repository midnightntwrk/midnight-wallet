import type { MessageResponse, MessageType } from '../background/types'

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 100

function isConnectionError(error: string | undefined): boolean {
  if (!error) return false
  return (
    error.includes('Could not establish connection') ||
    error.includes('Receiving end does not exist') ||
    error.includes('Extension context invalidated')
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sendMessageOnce<T>(
  type: MessageType,
  payload?: unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type, payload }, (response: MessageResponse<T>) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }

        if (!response) {
          reject(new Error('No response from background'))
          return
        }

        if (!response.success) {
          reject(new Error(response.error || 'Unknown error'))
          return
        }

        resolve(response.data as T)
      })
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Failed to send message'))
    }
  })
}

export async function sendMessage<T = unknown>(
  type: MessageType,
  payload?: unknown
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await sendMessageOnce<T>(type, payload)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Unknown error')

      if (!isConnectionError(lastError.message)) {
        throw lastError
      }

      if (attempt < MAX_RETRIES - 1) {
        await delay(RETRY_DELAY_MS * (attempt + 1))
      }
    }
  }

  throw lastError ?? new Error('Failed to connect to background service')
}

export async function getState() {
  return sendMessage<{
    isLocked: boolean
    activeWalletId: string | null
    sessionToken: string | null
  }>('GET_STATE')
}

export async function unlock(password: string, walletId: string) {
  return sendMessage<{ success: boolean }>('UNLOCK', { password, walletId })
}

export async function lock() {
  return sendMessage('LOCK')
}

export async function getWallets() {
  return sendMessage<Array<{ id: string; name: string; createdAt: number }>>('GET_WALLETS')
}

export async function createWallet(name: string, password: string, seedPhrase?: string) {
  return sendMessage<{ id: string; name: string; createdAt: number }>(
    'CREATE_WALLET',
    { name, password, seedPhrase }
  )
}

export async function importWallet(name: string, password: string, seedPhrase: string) {
  return sendMessage<{ id: string; name: string; createdAt: number }>(
    'IMPORT_WALLET',
    { name, password, seedPhrase }
  )
}

export async function deleteWallet(walletId: string) {
  return sendMessage('DELETE_WALLET', { walletId })
}

export async function getAccounts() {
  return sendMessage<string[]>('GET_ACCOUNTS')
}

export async function getAddress() {
  return sendMessage<string>('GET_ADDRESS')
}

export async function signTransaction(transaction: unknown) {
  return sendMessage<{ signedTransaction: string }>('SIGN_TRANSACTION', { transaction })
}

export async function generateMnemonic() {
  return sendMessage<string[]>('GENERATE_MNEMONIC')
}

export async function validateMnemonic(mnemonic: string[]) {
  return sendMessage<boolean>('VALIDATE_MNEMONIC', { mnemonic })
}

export async function deriveAccountAddress(accountIndex: number) {
  return sendMessage<{ address: string }>('DERIVE_ACCOUNT', { accountIndex })
}

export async function exportSeed(password: string, walletId: string) {
  return sendMessage<string[]>('EXPORT_SEED', { password, walletId })
}

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

export async function getBalances(address: string) {
  return sendMessage<Balances>('GET_BALANCES', { address })
}

export async function getTransactionHistory(address: string) {
  return sendMessage<Transaction[]>('GET_TX_HISTORY', { address })
}

export async function sendTokenTransaction(params: {
  to: string
  amount: string
  type: 'shielded' | 'unshielded'
  memo?: string
}) {
  return sendMessage<{ txHash: string }>('SEND_TRANSACTION', params)
}
