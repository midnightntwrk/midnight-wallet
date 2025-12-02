const ALLOWED_MESSAGE_TYPES = [
  'PING',
  'MIDNIGHT_CONNECT',
  'MIDNIGHT_DISCONNECT',
  'MIDNIGHT_GET_ACCOUNTS',
  'MIDNIGHT_SIGN_TRANSACTION',
  'MIDNIGHT_SEND_TRANSACTION',
] as const

type AllowedMessageType = typeof ALLOWED_MESSAGE_TYPES[number]

interface ExtensionMessage {
  type: AllowedMessageType
  payload?: unknown
  id?: string
}

function isValidMessage(data: unknown): data is ExtensionMessage {
  if (typeof data !== 'object' || data === null) return false
  const msg = data as { type?: unknown }
  if (typeof msg.type !== 'string') return false
  return (ALLOWED_MESSAGE_TYPES as readonly string[]).includes(msg.type)
}

function isValidSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Midnight Wallet extension installed')
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isValidSender(sender)) return false
  if (!isValidMessage(message)) return false

  if (message.type === 'PING') {
    sendResponse({ type: 'PONG' })
    return true
  }

  return false
})

export {}
