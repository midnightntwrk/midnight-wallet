const ALLOWED_MESSAGE_TYPES = [
  'MIDNIGHT_CONNECT',
  'MIDNIGHT_DISCONNECT',
  'MIDNIGHT_GET_ACCOUNTS',
  'MIDNIGHT_SIGN_TRANSACTION',
  'MIDNIGHT_SEND_TRANSACTION',
] as const

type AllowedMessageType = typeof ALLOWED_MESSAGE_TYPES[number]

interface MidnightMessage {
  type: AllowedMessageType
  payload?: unknown
  id?: string
}

function isValidMessage(data: unknown): data is MidnightMessage {
  if (typeof data !== 'object' || data === null) return false
  const msg = data as { type?: unknown }
  if (typeof msg.type !== 'string') return false
  return (ALLOWED_MESSAGE_TYPES as readonly string[]).includes(msg.type)
}

const injectProvider = () => {
  const script = document.createElement('script')
  script.src = chrome.runtime.getURL('injected/provider.js')
  script.type = 'module'
  ;(document.head || document.documentElement).appendChild(script)
  script.onload = () => script.remove()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectProvider)
} else {
  injectProvider()
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.origin !== window.location.origin) return
  if (!isValidMessage(event.data)) return
  chrome.runtime.sendMessage(event.data)
})

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id) return
  if (!isValidMessage(message)) return
  window.postMessage(message, window.location.origin)
})

export {}
