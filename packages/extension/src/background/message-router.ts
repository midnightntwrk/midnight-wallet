import type {
  MessageType,
  MessageResponse,
  WalletInfo,
  SessionState,
  EncryptedWallet,
} from './types'
import { encryptSeed, decryptSeed } from './crypto-service'
import {
  saveWallet,
  getWallets,
  getWallet,
  deleteWallet,
  generateWalletId,
} from './storage-service'
import {
  unlock,
  lock,
  getState,
  isUnlocked,
  refreshSession,
  getDecryptedSeed,
} from './session-manager'
import {
  generateMnemonic,
  validateMnemonic,
  createWallet as createWalletService,
  importWallet as importWalletService,
  deriveAccount,
} from './wallet-service'
import {
  getBalances,
  getTransactionHistory,
  sendTransaction,
  type Balances,
  type Transaction,
  type SendTransactionParams,
} from './transaction-service'
import { handleDappRequest, type DappRequest } from './dapp-handler'

const INTERNAL_MESSAGE_TYPES: MessageType[] = [
  'PING',
  'UNLOCK',
  'LOCK',
  'GET_STATE',
  'CREATE_WALLET',
  'IMPORT_WALLET',
  'GET_WALLETS',
  'DELETE_WALLET',
  'SIGN_TRANSACTION',
  'GET_ADDRESS',
  'GET_ACCOUNTS',
  'GENERATE_MNEMONIC',
  'VALIDATE_MNEMONIC',
  'DERIVE_ACCOUNT',
  'EXPORT_SEED',
  'GET_BALANCES',
  'GET_TX_HISTORY',
  'SEND_TRANSACTION',
]

function isValidMessageType(type: unknown): type is MessageType {
  if (typeof type !== 'string') return false
  return INTERNAL_MESSAGE_TYPES.includes(type as MessageType)
}

function isValidSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id
}

function isDappRequest(message: unknown): message is DappRequest {
  if (typeof message !== 'object' || message === null) return false
  const msg = message as Record<string, unknown>
  return msg['type'] === 'DAPP_REQUEST' && typeof msg['origin'] === 'string' && typeof msg['method'] === 'string'
}

async function handlePing(): Promise<MessageResponse> {
  return { success: true, data: { type: 'PONG' } }
}

async function handleGetState(): Promise<MessageResponse<SessionState>> {
  return { success: true, data: getState() }
}

async function handleUnlock(payload: {
  password: string
  walletId: string
}): Promise<MessageResponse> {
  if (!payload.password || !payload.walletId) {
    return { success: false, error: 'Missing password or walletId' }
  }
  return unlock(payload.password, payload.walletId)
}

async function handleLock(): Promise<MessageResponse> {
  await lock()
  return { success: true }
}

async function handleCreateWallet(payload: {
  name: string
  password: string
  seedPhrase?: string
}): Promise<MessageResponse<WalletInfo & { mnemonic?: string[] }>> {
  if (!payload.name || !payload.password) {
    return { success: false, error: 'Missing name or password' }
  }

  try {
    if (payload.seedPhrase) {
      const { encryptedSeed, salt } = await encryptSeed(payload.seedPhrase, payload.password)
      const wallet: EncryptedWallet = {
        id: await generateWalletId(),
        name: payload.name,
        encryptedSeed,
        salt,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      await saveWallet(wallet)
      return {
        success: true,
        data: {
          id: wallet.id,
          name: wallet.name,
          createdAt: wallet.createdAt,
        },
      }
    }

    const { id, mnemonic } = await createWalletService(payload.password, payload.name)
    return {
      success: true,
      data: {
        id,
        name: payload.name,
        createdAt: Date.now(),
        mnemonic,
      },
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create wallet',
    }
  }
}

async function handleImportWallet(payload: {
  name: string
  password: string
  seedPhrase: string
}): Promise<MessageResponse<WalletInfo>> {
  if (!payload.name || !payload.password || !payload.seedPhrase) {
    return { success: false, error: 'Missing name, password, or seedPhrase' }
  }

  const words = payload.seedPhrase.trim().split(/\s+/)
  if (words.length !== 12 && words.length !== 24) {
    return { success: false, error: 'Seed phrase must be 12 or 24 words' }
  }

  if (!validateMnemonic(words)) {
    return { success: false, error: 'Invalid seed phrase checksum' }
  }

  try {
    const id = await importWalletService(words, payload.password, payload.name)
    return {
      success: true,
      data: {
        id,
        name: payload.name,
        createdAt: Date.now(),
      },
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to import wallet',
    }
  }
}

async function handleGetWallets(): Promise<MessageResponse<WalletInfo[]>> {
  const wallets = await getWallets()
  return {
    success: true,
    data: wallets.map((w) => ({
      id: w.id,
      name: w.name,
      createdAt: w.createdAt,
    })),
  }
}

async function handleDeleteWallet(payload: {
  walletId: string
}): Promise<MessageResponse> {
  if (!payload.walletId) {
    return { success: false, error: 'Missing walletId' }
  }

  await deleteWallet(payload.walletId)
  return { success: true }
}

async function handleGetAccounts(): Promise<MessageResponse<string[]>> {
  if (!isUnlocked()) {
    return { success: false, error: 'Wallet is locked' }
  }

  refreshSession()
  const seed = getDecryptedSeed()
  if (!seed) {
    return { success: false, error: 'Could not access seed' }
  }

  try {
    const { address } = await deriveAccount(seed, 0)
    return { success: true, data: [address] }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to derive accounts',
    }
  }
}

async function handleSignTransaction(payload: {
  transaction: unknown
}): Promise<MessageResponse> {
  if (!isUnlocked()) {
    return { success: false, error: 'Wallet is locked' }
  }

  if (!payload.transaction) {
    return { success: false, error: 'Missing transaction' }
  }

  refreshSession()

  const seed = getDecryptedSeed()
  if (!seed) {
    return { success: false, error: 'Could not access seed' }
  }

  return {
    success: true,
    data: { signedTransaction: 'mock_signed_tx' },
  }
}

async function handleGetAddress(): Promise<MessageResponse<string>> {
  if (!isUnlocked()) {
    return { success: false, error: 'Wallet is locked' }
  }

  refreshSession()
  const seed = getDecryptedSeed()
  if (!seed) {
    return { success: false, error: 'Could not access seed' }
  }

  try {
    const { address } = await deriveAccount(seed, 0)
    return { success: true, data: address }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to derive address',
    }
  }
}

async function handleGenerateMnemonic(): Promise<MessageResponse<string[]>> {
  try {
    const mnemonic = generateMnemonic()
    return { success: true, data: mnemonic }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to generate mnemonic',
    }
  }
}

async function handleValidateMnemonic(payload: {
  mnemonic: string[]
}): Promise<MessageResponse<boolean>> {
  if (!payload.mnemonic || !Array.isArray(payload.mnemonic)) {
    return { success: false, error: 'Missing mnemonic' }
  }

  const isValid = validateMnemonic(payload.mnemonic)
  return { success: true, data: isValid }
}

async function handleDeriveAccount(payload: {
  accountIndex: number
}): Promise<MessageResponse<{ address: string }>> {
  if (!isUnlocked()) {
    return { success: false, error: 'Wallet is locked' }
  }

  refreshSession()
  const seed = getDecryptedSeed()
  if (!seed) {
    return { success: false, error: 'Could not access seed' }
  }

  try {
    const { address } = await deriveAccount(seed, payload.accountIndex ?? 0)
    return { success: true, data: { address } }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to derive account',
    }
  }
}

async function handleExportSeed(payload: {
  password: string
  walletId: string
}): Promise<MessageResponse<string[]>> {
  if (!isUnlocked()) {
    return { success: false, error: 'Wallet is locked' }
  }

  if (!payload.password || !payload.walletId) {
    return { success: false, error: 'Password and walletId required for seed export' }
  }

  try {
    const wallet = await getWallet(payload.walletId)
    if (!wallet) {
      return { success: false, error: 'Wallet not found' }
    }

    const seed = await decryptSeed(wallet.encryptedSeed, wallet.salt, payload.password)
    const words = seed.split(' ')
    refreshSession()
    return { success: true, data: words }
  } catch {
    return { success: false, error: 'Invalid password' }
  }
}

async function handleGetBalances(payload: {
  address: string
}): Promise<MessageResponse<Balances>> {
  if (!isUnlocked()) {
    return { success: false, error: 'Wallet is locked' }
  }

  if (!payload.address) {
    return { success: false, error: 'Address is required' }
  }

  refreshSession()

  try {
    const balances = await getBalances(payload.address)
    return { success: true, data: balances }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to get balances',
    }
  }
}

async function handleGetTxHistory(payload: {
  address: string
}): Promise<MessageResponse<Transaction[]>> {
  if (!isUnlocked()) {
    return { success: false, error: 'Wallet is locked' }
  }

  if (!payload.address) {
    return { success: false, error: 'Address is required' }
  }

  refreshSession()

  try {
    const transactions = await getTransactionHistory(payload.address)
    return { success: true, data: transactions }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to get transaction history',
    }
  }
}

async function handleSendTransaction(
  payload: SendTransactionParams
): Promise<MessageResponse<{ txHash: string }>> {
  if (!isUnlocked()) {
    return { success: false, error: 'Wallet is locked' }
  }

  if (!payload.to || !payload.amount) {
    return { success: false, error: 'Missing required transaction parameters' }
  }

  refreshSession()

  try {
    const txHash = await sendTransaction(payload)
    return { success: true, data: { txHash } }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to send transaction',
    }
  }
}

export async function handleMessage(
  message: { type: MessageType; payload?: unknown } | DappRequest,
  sender: chrome.runtime.MessageSender
): Promise<MessageResponse> {
  if (!isValidSender(sender)) {
    return { success: false, error: 'Invalid sender' }
  }

  if (isDappRequest(message)) {
    return handleDappRequest(message)
  }

  if (!isValidMessageType(message.type)) {
    return { success: false, error: 'Invalid message type' }
  }

  const payload = message.payload as Record<string, unknown> | undefined

  switch (message.type) {
    case 'PING':
      return handlePing()

    case 'GET_STATE':
      return handleGetState()

    case 'UNLOCK':
      return handleUnlock(payload as { password: string; walletId: string })

    case 'LOCK':
      return handleLock()

    case 'CREATE_WALLET':
      return handleCreateWallet(
        payload as { name: string; password: string; seedPhrase?: string }
      )

    case 'IMPORT_WALLET':
      return handleImportWallet(
        payload as { name: string; password: string; seedPhrase: string }
      )

    case 'GET_WALLETS':
      return handleGetWallets()

    case 'DELETE_WALLET':
      return handleDeleteWallet(payload as { walletId: string })

    case 'GET_ACCOUNTS':
      return handleGetAccounts()

    case 'SIGN_TRANSACTION':
      return handleSignTransaction(payload as { transaction: unknown })

    case 'GET_ADDRESS':
      return handleGetAddress()

    case 'GENERATE_MNEMONIC':
      return handleGenerateMnemonic()

    case 'VALIDATE_MNEMONIC':
      return handleValidateMnemonic(payload as { mnemonic: string[] })

    case 'DERIVE_ACCOUNT':
      return handleDeriveAccount(payload as { accountIndex: number })

    case 'EXPORT_SEED':
      return handleExportSeed(payload as { password: string; walletId: string })

    case 'GET_BALANCES':
      return handleGetBalances(payload as { address: string })

    case 'GET_TX_HISTORY':
      return handleGetTxHistory(payload as { address: string })

    case 'SEND_TRANSACTION':
      return handleSendTransaction(payload as unknown as SendTransactionParams)

    default:
      return { success: false, error: 'Unknown message type' }
  }
}

export function setupMessageListener(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      })
    return true
  })
}
