import type { MessageResponse, MessageType } from '../background/types'

export async function sendMessage<T = unknown>(
  type: MessageType,
  payload?: unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
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
  })
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
