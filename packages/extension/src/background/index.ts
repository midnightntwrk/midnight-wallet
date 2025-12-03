import { setupMessageListener } from './message-router'
import { restoreSession } from './session-manager'
import { setupApprovalListener } from './approval-manager'

const KEEP_ALIVE_INTERVAL_MS = 25000

function setupKeepAlive(): void {
  setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
      // no-op
    })
  }, KEEP_ALIVE_INTERVAL_MS)
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Nocturne Wallet extension installed')
})

chrome.runtime.onStartup.addListener(() => {
  console.log('Nocturne Wallet background service starting up')
  restoreSession().catch(console.error)
})

restoreSession().catch(console.error)

setupMessageListener()
setupApprovalListener()
setupKeepAlive()

console.log('Nocturne Wallet background service started')

export {}
