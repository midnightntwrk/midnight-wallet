import type { EncryptedWallet, Session } from './types'

const DB_NAME = 'midnight-wallet'
const DB_VERSION = 1
const WALLETS_STORE = 'wallets'
const SESSION_STORE = 'session'

let dbInstance: IDBDatabase | null = null

export async function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)

    request.onsuccess = () => {
      dbInstance = request.result
      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      if (!db.objectStoreNames.contains(WALLETS_STORE)) {
        db.createObjectStore(WALLETS_STORE, { keyPath: 'id' })
      }

      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: 'token' })
      }
    }
  })
}

export async function saveWallet(wallet: EncryptedWallet): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(WALLETS_STORE, 'readwrite')
    const store = transaction.objectStore(WALLETS_STORE)
    const request = store.put(wallet)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

export async function getWallet(id: string): Promise<EncryptedWallet | null> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(WALLETS_STORE, 'readonly')
    const store = transaction.objectStore(WALLETS_STORE)
    const request = store.get(id)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result ?? null)
  })
}

export async function getWallets(): Promise<EncryptedWallet[]> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(WALLETS_STORE, 'readonly')
    const store = transaction.objectStore(WALLETS_STORE)
    const request = store.getAll()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result ?? [])
  })
}

export async function deleteWallet(id: string): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(WALLETS_STORE, 'readwrite')
    const store = transaction.objectStore(WALLETS_STORE)
    const request = store.delete(id)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

export async function saveSession(session: Session): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SESSION_STORE, 'readwrite')
    const store = transaction.objectStore(SESSION_STORE)
    store.clear()
    const request = store.put(session)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

export async function getSession(): Promise<Session | null> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SESSION_STORE, 'readonly')
    const store = transaction.objectStore(SESSION_STORE)
    const request = store.getAll()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const sessions = request.result ?? []
      resolve(sessions.length > 0 ? sessions[0] : null)
    }
  })
}

export async function clearSession(): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SESSION_STORE, 'readwrite')
    const store = transaction.objectStore(SESSION_STORE)
    const request = store.clear()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

export async function generateWalletId(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
