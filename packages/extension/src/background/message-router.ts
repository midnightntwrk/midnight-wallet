import type {
  MessageType,
  MessageResponse,
  WalletInfo,
  SessionState,
  EncryptedWallet,
} from './types'
import { encryptSeed } from './crypto-service'
import {
  saveWallet,
  getWallets,
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
]

const DAPP_MESSAGE_TYPES: MessageType[] = [
  'MIDNIGHT_CONNECT',
  'MIDNIGHT_DISCONNECT',
  'MIDNIGHT_GET_ACCOUNTS',
  'MIDNIGHT_SIGN_TRANSACTION',
  'MIDNIGHT_SEND_TRANSACTION',
]

function isValidMessageType(type: unknown): type is MessageType {
  if (typeof type !== 'string') return false
  return (
    INTERNAL_MESSAGE_TYPES.includes(type as MessageType) ||
    DAPP_MESSAGE_TYPES.includes(type as MessageType)
  )
}

function isValidSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id
}

function isDAppMessage(type: MessageType): boolean {
  return DAPP_MESSAGE_TYPES.includes(type)
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
}): Promise<MessageResponse<WalletInfo>> {
  if (!payload.name || !payload.password) {
    return { success: false, error: 'Missing name or password' }
  }

  const seedPhrase =
    payload.seedPhrase || generateMockSeedPhrase()

  const { encryptedSeed, salt } = await encryptSeed(seedPhrase, payload.password)

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

async function handleImportWallet(payload: {
  name: string
  password: string
  seedPhrase: string
}): Promise<MessageResponse<WalletInfo>> {
  if (!payload.name || !payload.password || !payload.seedPhrase) {
    return { success: false, error: 'Missing name, password, or seedPhrase' }
  }

  if (!isValidSeedPhrase(payload.seedPhrase)) {
    return { success: false, error: 'Invalid seed phrase format' }
  }

  const { encryptedSeed, salt } = await encryptSeed(
    payload.seedPhrase,
    payload.password
  )

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
  return { success: true, data: ['midnight1mock...address'] }
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
  return { success: true, data: 'midnight1mock...address' }
}

async function handleDAppConnect(): Promise<MessageResponse> {
  if (!isUnlocked()) {
    return { success: false, error: 'Wallet is locked' }
  }

  return { success: true, data: { connected: true } }
}

async function handleDAppDisconnect(): Promise<MessageResponse> {
  return { success: true }
}

async function handleDAppGetAccounts(): Promise<MessageResponse<string[]>> {
  return handleGetAccounts()
}

async function handleDAppSignTransaction(payload: {
  transaction: unknown
}): Promise<MessageResponse> {
  return handleSignTransaction(payload)
}

async function handleDAppSendTransaction(payload: {
  signedTransaction: unknown
}): Promise<MessageResponse> {
  if (!isUnlocked()) {
    return { success: false, error: 'Wallet is locked' }
  }

  if (!payload.signedTransaction) {
    return { success: false, error: 'Missing signedTransaction' }
  }

  refreshSession()
  return { success: true, data: { txHash: 'mock_tx_hash' } }
}

function generateMockSeedPhrase(): string {
  const words = [
    'abandon', 'ability', 'able', 'about', 'above', 'absent',
    'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident',
  ]
  const phrase: string[] = []
  for (let i = 0; i < 12; i++) {
    const randomIndex = Math.floor(Math.random() * words.length)
    phrase.push(words[randomIndex])
  }
  return phrase.join(' ')
}

function isValidSeedPhrase(phrase: string): boolean {
  const words = phrase.trim().split(/\s+/)
  return words.length === 12 || words.length === 24
}

export async function handleMessage(
  message: { type: MessageType; payload?: unknown },
  sender: chrome.runtime.MessageSender
): Promise<MessageResponse> {
  if (!isValidSender(sender)) {
    return { success: false, error: 'Invalid sender' }
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

    case 'MIDNIGHT_CONNECT':
      return handleDAppConnect()

    case 'MIDNIGHT_DISCONNECT':
      return handleDAppDisconnect()

    case 'MIDNIGHT_GET_ACCOUNTS':
      return handleDAppGetAccounts()

    case 'MIDNIGHT_SIGN_TRANSACTION':
      return handleDAppSignTransaction(payload as { transaction: unknown })

    case 'MIDNIGHT_SEND_TRANSACTION':
      return handleDAppSendTransaction(
        payload as { signedTransaction: unknown }
      )

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
