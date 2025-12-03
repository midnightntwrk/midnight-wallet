interface NocturneRequest {
  method: string
  params?: unknown
}

interface NocturneResponse {
  type: 'NOCTURNE_RESPONSE'
  id: string
  result?: unknown
  error?: string
}

interface NocturneEvent {
  type: 'NOCTURNE_EVENT'
  event: string
  data: unknown
}

type EventHandler = (data: unknown) => void

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
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

interface WalletAPI {
  state(): Promise<WalletState>
  submitTransaction(transaction: unknown): Promise<string>
  balanceAndProveTransaction(transaction: unknown): Promise<unknown>
}

const REQUEST_TIMEOUT_MS = 30000
const pending = new Map<string, PendingRequest>()
const eventListeners = new Map<string, Set<EventHandler>>()

function generateId(): string {
  return crypto.randomUUID()
}

function cleanupPending(id: string): void {
  const request = pending.get(id)
  if (request) {
    clearTimeout(request.timeoutId)
    pending.delete(id)
  }
}

function handleResponse(event: MessageEvent<NocturneResponse | NocturneEvent>) {
  if (event.source !== window) return
  if (event.origin !== window.location.origin) return

  const data = event.data
  if (!data || typeof data !== 'object') return

  if (data.type === 'NOCTURNE_RESPONSE') {
    const { id, result, error } = data
    const pendingRequest = pending.get(id)
    if (pendingRequest) {
      cleanupPending(id)
      if (error) {
        pendingRequest.reject(new Error(error))
      } else {
        pendingRequest.resolve(result)
      }
    }
  }

  if (data.type === 'NOCTURNE_EVENT') {
    const handlers = eventListeners.get(data.event)
    if (handlers) {
      handlers.forEach(handler => handler(data.data))
    }
  }
}

function cleanupAllPending(): void {
  pending.forEach((request) => {
    clearTimeout(request.timeoutId)
    request.reject(new Error('Page unloading'))
  })
  pending.clear()
}

function request({ method, params }: NocturneRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = generateId()

    const timeoutId = setTimeout(() => {
      if (pending.has(id)) {
        cleanupPending(id)
        reject(new Error('Request timeout'))
      }
    }, REQUEST_TIMEOUT_MS)

    pending.set(id, { resolve, reject, timeoutId })

    window.postMessage({
      type: 'NOCTURNE_REQUEST',
      id,
      method,
      params,
    }, window.location.origin)
  })
}

function createWalletAPI(): WalletAPI {
  return {
    async state(): Promise<WalletState> {
      return request({ method: 'midnight_state' }) as Promise<WalletState>
    },

    async submitTransaction(transaction: unknown): Promise<string> {
      return request({ method: 'midnight_submitTransaction', params: { transaction } }) as Promise<string>
    },

    async balanceAndProveTransaction(transaction: unknown): Promise<unknown> {
      return request({ method: 'midnight_balanceAndProveTransaction', params: { transaction } })
    },
  }
}

const nocturne = {
  apiVersion: '3.0.0',
  name: 'Nocturne',
  icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iIzRGNDZFNSIvPjxwYXRoIGQ9Ik0xMCA4QzEwIDggMTQgMTYgMTYgMTZDMTggMTYgMjIgOCAyMiA4QzIyIDggMTggMjQgMTYgMjRDMTQgMjQgMTAgOCAxMCA4WiIgZmlsbD0id2hpdGUiLz48L3N2Zz4=',

  async isEnabled(): Promise<boolean> {
    try {
      const result = await request({ method: 'midnight_isEnabled' })
      return Boolean(result)
    } catch {
      return false
    }
  },

  async enable(): Promise<WalletAPI> {
    await request({ method: 'midnight_enable' })
    return createWalletAPI()
  },

  async serviceUriConfig(): Promise<ServiceUriConfig> {
    return request({ method: 'midnight_serviceUriConfig' }) as Promise<ServiceUriConfig>
  },

  on(event: string, handler: EventHandler): void {
    if (!eventListeners.has(event)) {
      eventListeners.set(event, new Set())
    }
    eventListeners.get(event)!.add(handler)
  },

  removeListener(event: string, handler: EventHandler): void {
    const handlers = eventListeners.get(event)
    if (handlers) {
      handlers.delete(handler)
    }
  },

  removeAllListeners(event?: string): void {
    if (event) {
      eventListeners.delete(event)
    } else {
      eventListeners.clear()
    }
  },
}

window.addEventListener('message', handleResponse)
window.addEventListener('beforeunload', cleanupAllPending)

const win = window as Window & { midnight?: Record<string, unknown> }
if (!win.midnight) {
  win.midnight = {}
}

Object.defineProperty(win.midnight, 'nocturne', {
  value: nocturne,
  writable: false,
  configurable: false,
})

window.dispatchEvent(new Event('midnight#initialized'))
window.dispatchEvent(new Event('nocturne#initialized'))
