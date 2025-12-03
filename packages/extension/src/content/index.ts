const ALLOWED_METHODS = [
  'midnight_enable',
  'midnight_isEnabled',
  'midnight_state',
  'midnight_serviceUriConfig',
  'midnight_submitTransaction',
  'midnight_balanceAndProveTransaction',
] as const

interface NocturneRequest {
  type: 'NOCTURNE_REQUEST'
  id: string
  method: string
  params?: unknown
}

function isValidRequest(data: unknown): data is NocturneRequest {
  if (typeof data !== 'object' || data === null) return false
  const msg = data as Record<string, unknown>
  if (msg['type'] !== 'NOCTURNE_REQUEST') return false
  if (typeof msg['id'] !== 'string') return false
  if (typeof msg['method'] !== 'string') return false
  return (ALLOWED_METHODS as readonly string[]).includes(msg['method'] as string)
}

function injectProvider(): void {
  if (document.getElementById('nocturne-provider-script')) return

  const script = document.createElement('script')
  script.id = 'nocturne-provider-script'
  script.src = chrome.runtime.getURL('injected/provider.js')
  script.type = 'module'
  ;(document.head || document.documentElement).appendChild(script)
  script.onload = () => script.remove()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectProvider, { once: true })
} else {
  injectProvider()
}

window.addEventListener('message', async (event) => {
  if (event.source !== window) return
  if (event.origin !== window.location.origin) return
  if (!isValidRequest(event.data)) return

  const { id, method, params } = event.data
  const origin = window.location.origin

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'DAPP_REQUEST',
      origin,
      method,
      params,
      id,
    })

    window.postMessage({
      type: 'NOCTURNE_RESPONSE',
      id,
      result: response?.data,
      error: response?.error,
    }, window.location.origin)
  } catch (error) {
    window.postMessage({
      type: 'NOCTURNE_RESPONSE',
      id,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, window.location.origin)
  }
})

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'NOCTURNE_EVENT') {
    window.postMessage({
      type: 'NOCTURNE_EVENT',
      event: message.event,
      data: message.data,
    }, window.location.origin)
  }
})

export {}
