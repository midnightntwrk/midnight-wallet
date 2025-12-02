export interface EncryptedData {
  iv: string
  ciphertext: string
}

export interface EncryptedWallet {
  id: string
  name: string
  encryptedSeed: EncryptedData
  salt: string
  createdAt: number
  updatedAt: number
}

export interface Session {
  token: string
  expiresAt: number
  walletId: string
}

export interface SessionState {
  isLocked: boolean
  activeWalletId: string | null
  sessionToken: string | null
}

export type InternalMessageType =
  | 'UNLOCK'
  | 'LOCK'
  | 'GET_STATE'
  | 'CREATE_WALLET'
  | 'IMPORT_WALLET'
  | 'GET_WALLETS'
  | 'DELETE_WALLET'
  | 'SIGN_TRANSACTION'
  | 'GET_ADDRESS'
  | 'GET_ACCOUNTS'

export type DAppMessageType =
  | 'MIDNIGHT_CONNECT'
  | 'MIDNIGHT_DISCONNECT'
  | 'MIDNIGHT_GET_ACCOUNTS'
  | 'MIDNIGHT_SIGN_TRANSACTION'
  | 'MIDNIGHT_SEND_TRANSACTION'

export type MessageType = InternalMessageType | DAppMessageType | 'PING'

export interface BaseMessage {
  type: MessageType
  id?: string
}

export interface UnlockMessage extends BaseMessage {
  type: 'UNLOCK'
  payload: { password: string; walletId: string }
}

export interface LockMessage extends BaseMessage {
  type: 'LOCK'
}

export interface GetStateMessage extends BaseMessage {
  type: 'GET_STATE'
}

export interface CreateWalletMessage extends BaseMessage {
  type: 'CREATE_WALLET'
  payload: { name: string; password: string; seedPhrase?: string }
}

export interface ImportWalletMessage extends BaseMessage {
  type: 'IMPORT_WALLET'
  payload: { name: string; password: string; seedPhrase: string }
}

export interface GetWalletsMessage extends BaseMessage {
  type: 'GET_WALLETS'
}

export interface DeleteWalletMessage extends BaseMessage {
  type: 'DELETE_WALLET'
  payload: { walletId: string }
}

export interface SignTransactionMessage extends BaseMessage {
  type: 'SIGN_TRANSACTION'
  payload: { transaction: unknown }
}

export interface GetAddressMessage extends BaseMessage {
  type: 'GET_ADDRESS'
}

export interface GetAccountsMessage extends BaseMessage {
  type: 'GET_ACCOUNTS'
}

export type ExtensionMessage =
  | UnlockMessage
  | LockMessage
  | GetStateMessage
  | CreateWalletMessage
  | ImportWalletMessage
  | GetWalletsMessage
  | DeleteWalletMessage
  | SignTransactionMessage
  | GetAddressMessage
  | GetAccountsMessage
  | BaseMessage

export interface MessageResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface WalletInfo {
  id: string
  name: string
  createdAt: number
}

export interface UnlockAttempt {
  timestamp: number
  walletId: string
}

export const DEFAULT_LOCK_TIMEOUT_MINUTES = 15
export const MAX_UNLOCK_ATTEMPTS = 5
export const UNLOCK_COOLDOWN_MS = 60000
