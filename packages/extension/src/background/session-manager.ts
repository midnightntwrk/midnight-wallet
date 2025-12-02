import type { Session, SessionState, UnlockAttempt } from './types'
import {
  DEFAULT_LOCK_TIMEOUT_MINUTES,
  MAX_UNLOCK_ATTEMPTS,
  UNLOCK_COOLDOWN_MS,
} from './types'
import { decryptSeed, generateSessionToken } from './crypto-service'
import {
  getSession,
  saveSession,
  clearSession,
  getWallet,
} from './storage-service'

let currentSession: Session | null = null
let decryptedSeed: string | null = null
let lockTimer: ReturnType<typeof setTimeout> | null = null
let lockTimeoutMinutes = DEFAULT_LOCK_TIMEOUT_MINUTES

const unlockAttempts: UnlockAttempt[] = []

export function isRateLimited(walletId: string): boolean {
  const now = Date.now()
  const recentAttempts = unlockAttempts.filter(
    (a) => a.walletId === walletId && now - a.timestamp < UNLOCK_COOLDOWN_MS
  )
  return recentAttempts.length >= MAX_UNLOCK_ATTEMPTS
}

function recordUnlockAttempt(walletId: string): void {
  unlockAttempts.push({ timestamp: Date.now(), walletId })
  while (unlockAttempts.length > 100) {
    unlockAttempts.shift()
  }
}

export function isUnlocked(): boolean {
  if (!currentSession) return false
  return Date.now() < currentSession.expiresAt
}

export function getState(): SessionState {
  return {
    isLocked: !isUnlocked(),
    activeWalletId: currentSession?.walletId ?? null,
    sessionToken: currentSession?.token ?? null,
  }
}

export function getDecryptedSeed(): string | null {
  if (!isUnlocked()) return null
  return decryptedSeed
}

export async function unlock(
  password: string,
  walletId: string
): Promise<{ success: boolean; error?: string }> {
  if (isRateLimited(walletId)) {
    return { success: false, error: 'Too many unlock attempts. Try again later.' }
  }

  recordUnlockAttempt(walletId)

  try {
    const wallet = await getWallet(walletId)
    if (!wallet) {
      return { success: false, error: 'Wallet not found' }
    }

    const seed = await decryptSeed(wallet.encryptedSeed, wallet.salt, password)

    const session: Session = {
      token: generateSessionToken(),
      expiresAt: Date.now() + lockTimeoutMinutes * 60 * 1000,
      walletId,
    }

    await saveSession(session)
    currentSession = session
    decryptedSeed = seed

    resetLockTimer()

    return { success: true }
  } catch {
    return { success: false, error: 'Invalid password' }
  }
}

export async function lock(): Promise<void> {
  currentSession = null
  decryptedSeed = null

  if (lockTimer) {
    clearTimeout(lockTimer)
    lockTimer = null
  }

  await clearSession()
}

export function refreshSession(): void {
  if (!currentSession) return

  currentSession.expiresAt = Date.now() + lockTimeoutMinutes * 60 * 1000
  saveSession(currentSession).catch(console.error)
  resetLockTimer()
}

function resetLockTimer(): void {
  if (lockTimer) {
    clearTimeout(lockTimer)
  }
  lockTimer = setTimeout(() => {
    lock().catch(console.error)
  }, lockTimeoutMinutes * 60 * 1000)
}

export function setLockTimeout(minutes: number): void {
  if (minutes < 1 || minutes > 60) return
  lockTimeoutMinutes = minutes

  if (isUnlocked()) {
    refreshSession()
  }
}

export function getLockTimeout(): number {
  return lockTimeoutMinutes
}

export async function restoreSession(): Promise<void> {
  const session = await getSession()
  if (!session) return

  if (Date.now() >= session.expiresAt) {
    await clearSession()
    return
  }

  currentSession = session
  resetLockTimer()
}
