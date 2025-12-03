export type ApprovalType = 'connect' | 'transaction' | 'message'

export interface ApprovalData {
  origin: string
  transaction?: {
    to: string
    amount: string
    type: 'shielded' | 'unshielded'
    memo?: string
  }
  message?: string
}

interface PendingApproval {
  resolve: (approved: boolean) => void
  type: ApprovalType
  data: ApprovalData
}

const APPROVED_ORIGINS_KEY = 'midnight_approved_origins'
const pendingApprovals = new Map<number, PendingApproval>()

async function getApprovedOriginsFromStorage(): Promise<string[]> {
  try {
    const result = await chrome.storage.local.get(APPROVED_ORIGINS_KEY)
    return result[APPROVED_ORIGINS_KEY] || []
  } catch {
    return []
  }
}

async function saveApprovedOrigins(origins: string[]): Promise<void> {
  await chrome.storage.local.set({ [APPROVED_ORIGINS_KEY]: origins })
}

export async function isOriginApproved(origin: string): Promise<boolean> {
  const origins = await getApprovedOriginsFromStorage()
  return origins.includes(origin)
}

export async function approveOrigin(origin: string): Promise<void> {
  const origins = await getApprovedOriginsFromStorage()
  if (!origins.includes(origin)) {
    origins.push(origin)
    await saveApprovedOrigins(origins)
  }
}

export async function revokeOrigin(origin: string): Promise<void> {
  const origins = await getApprovedOriginsFromStorage()
  const filtered = origins.filter(o => o !== origin)
  await saveApprovedOrigins(filtered)
}

export async function getApprovedOrigins(): Promise<string[]> {
  return getApprovedOriginsFromStorage()
}

export function requestApproval(type: ApprovalType, data: ApprovalData): Promise<boolean> {
  return new Promise((resolve) => {
    const popupUrl = chrome.runtime.getURL(
      `popup/index.html#/approve/${type}?data=${encodeURIComponent(JSON.stringify(data))}`
    )

    chrome.windows.create({
      url: popupUrl,
      type: 'popup',
      width: 400,
      height: 620,
      focused: true,
    }, (window) => {
      if (!window?.id) {
        resolve(false)
        return
      }

      pendingApprovals.set(window.id, { resolve, type, data })

      chrome.windows.onRemoved.addListener(function onRemoved(windowId) {
        if (windowId === window.id) {
          chrome.windows.onRemoved.removeListener(onRemoved)
          const pending = pendingApprovals.get(windowId)
          if (pending) {
            pendingApprovals.delete(windowId)
            pending.resolve(false)
          }
        }
      })
    })
  })
}

export async function handleApprovalResponse(
  windowId: number,
  approved: boolean,
  origin?: string
): Promise<void> {
  const pending = pendingApprovals.get(windowId)
  if (!pending) return

  pendingApprovals.delete(windowId)

  if (approved && pending.type === 'connect' && origin) {
    await approveOrigin(origin)
  }

  pending.resolve(approved)

  try {
    await chrome.windows.remove(windowId)
  } catch {}
}

export function setupApprovalListener(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'APPROVAL_RESPONSE') {
      const windowId = sender.tab?.windowId
      if (windowId) {
        handleApprovalResponse(windowId, message.approved, message.origin)
          .then(() => sendResponse({ success: true }))
          .catch(() => sendResponse({ success: false }))
        return true
      }
    }
    return false
  })
}
