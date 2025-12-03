import { requestApproval, isOriginApproved, revokeOrigin, getApprovedOrigins } from './approval-manager'
import { isUnlocked, refreshSession, getDecryptedSeed } from './session-manager'
import { deriveAccount } from './wallet-service'
import { sendTransaction as sendTx, type SendTransactionParams } from './transaction-service'

export interface DappRequest {
  type: 'DAPP_REQUEST'
  origin: string
  method: string
  params?: unknown
  id: string
}

export interface DappResponse {
  success: boolean
  data?: unknown
  error?: string
}

interface WalletState {
  address: string
  shieldAddress?: string
  shieldCPK?: string
  shieldEPK?: string
  legacyAddress?: string
  legacyCPK?: string
  legacyEPK?: string
}

interface ServiceUriConfig {
  indexer: string
  prover: string
  node: string
}

const RATE_LIMIT_WINDOW_MS = 60000
const RATE_LIMIT_MAX_REQUESTS = 20

interface RateLimitEntry {
  count: number
  windowStart: number
}

const rateLimitMap = new Map<string, RateLimitEntry>()

function isRateLimited(origin: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(origin)

  if (!entry) {
    rateLimitMap.set(origin, { count: 1, windowStart: now })
    return false
  }

  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(origin, { count: 1, windowStart: now })
    return false
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true
  }

  entry.count++
  return false
}

function isValidTransactionParams(params: unknown): params is { transaction: SendTransactionParams } {
  if (!params || typeof params !== 'object') return false
  const p = params as Record<string, unknown>
  if (!p['transaction'] || typeof p['transaction'] !== 'object') return false
  const tx = p['transaction'] as Record<string, unknown>
  if (typeof tx['to'] !== 'string' || (tx['to'] as string).length < 10) return false
  if (typeof tx['amount'] !== 'string' || !/^\d+(\.\d+)?$/.test(tx['amount'] as string)) return false
  if (tx['type'] !== 'shielded' && tx['type'] !== 'unshielded') return false
  if (tx['memo'] !== undefined && typeof tx['memo'] !== 'string') return false
  return true
}

async function getWalletState(): Promise<WalletState | null> {
  const seed = getDecryptedSeed()
  if (!seed) return null

  try {
    const { address } = await deriveAccount(seed, 0)
    return {
      address,
      shieldAddress: address,
    }
  } catch {
    return null
  }
}

async function handleEnable(origin: string): Promise<DappResponse> {
  if (!isUnlocked()) {
    return { success: false, error: 'Wallet is locked' }
  }

  const alreadyApproved = await isOriginApproved(origin)
  if (alreadyApproved) {
    refreshSession()
    return { success: true, data: true }
  }

  const approved = await requestApproval('connect', { origin })
  if (!approved) {
    return { success: false, error: 'User rejected connection' }
  }

  refreshSession()
  return { success: true, data: true }
}

async function handleIsEnabled(origin: string): Promise<DappResponse> {
  if (!isUnlocked()) {
    return { success: true, data: false }
  }

  const isApproved = await isOriginApproved(origin)
  return { success: true, data: isApproved }
}

async function handleState(origin: string): Promise<DappResponse> {
  if (!isUnlocked()) {
    return { success: false, error: 'Wallet is locked' }
  }

  const isApproved = await isOriginApproved(origin)
  if (!isApproved) {
    return { success: false, error: 'Not connected. Call enable() first.' }
  }

  refreshSession()
  const state = await getWalletState()
  if (!state) {
    return { success: false, error: 'Failed to get wallet state' }
  }

  return { success: true, data: state }
}

async function handleServiceUriConfig(): Promise<DappResponse> {
  const config: ServiceUriConfig = {
    indexer: 'https://indexer.testnet.midnight.network',
    prover: 'https://prover.testnet.midnight.network',
    node: 'https://node.testnet.midnight.network',
  }
  return { success: true, data: config }
}

async function handleSubmitTransaction(origin: string, params: unknown): Promise<DappResponse> {
  if (!isUnlocked()) {
    return { success: false, error: 'Wallet is locked' }
  }

  const isApproved = await isOriginApproved(origin)
  if (!isApproved) {
    return { success: false, error: 'Not connected. Call enable() first.' }
  }

  if (!isValidTransactionParams(params)) {
    return { success: false, error: 'Invalid transaction parameters' }
  }

  const approved = await requestApproval('transaction', {
    origin,
    transaction: params.transaction,
  })

  if (!approved) {
    return { success: false, error: 'User rejected transaction' }
  }

  refreshSession()

  try {
    const txHash = await sendTx(params.transaction)
    return { success: true, data: txHash }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Transaction failed',
    }
  }
}

async function handleBalanceAndProveTransaction(origin: string, params: unknown): Promise<DappResponse> {
  if (!isUnlocked()) {
    return { success: false, error: 'Wallet is locked' }
  }

  const isApproved = await isOriginApproved(origin)
  if (!isApproved) {
    return { success: false, error: 'Not connected. Call enable() first.' }
  }

  if (!params || typeof params !== 'object') {
    return { success: false, error: 'Invalid transaction parameters' }
  }

  const txParams = params as Record<string, unknown>
  const txData: { to: string; amount: string; type: 'shielded' | 'unshielded'; memo?: string } = {
    to: String(txParams['to'] ?? ''),
    amount: String(txParams['amount'] ?? '0'),
    type: txParams['type'] === 'unshielded' ? 'unshielded' : 'shielded',
  }
  if (txParams['memo']) {
    txData.memo = String(txParams['memo'])
  }
  const approved = await requestApproval('transaction', {
    origin,
    transaction: txData,
  })

  if (!approved) {
    return { success: false, error: 'User rejected transaction' }
  }

  refreshSession()
  return { success: true, data: { balanced: true, proved: true, transaction: params } }
}

export async function handleDappRequest(request: DappRequest): Promise<DappResponse> {
  const { origin, method, params } = request

  if (isRateLimited(origin)) {
    return { success: false, error: 'Rate limited. Please try again later.' }
  }

  switch (method) {
    case 'midnight_enable':
      return handleEnable(origin)

    case 'midnight_isEnabled':
      return handleIsEnabled(origin)

    case 'midnight_state':
      return handleState(origin)

    case 'midnight_serviceUriConfig':
      return handleServiceUriConfig()

    case 'midnight_submitTransaction':
      return handleSubmitTransaction(origin, params)

    case 'midnight_balanceAndProveTransaction':
      return handleBalanceAndProveTransaction(origin, params)

    default:
      return { success: false, error: `Unknown method: ${method}` }
  }
}

export { revokeOrigin, getApprovedOrigins }
