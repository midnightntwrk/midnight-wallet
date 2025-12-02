import { setupMessageListener } from './message-router'
import { restoreSession } from './session-manager'

chrome.runtime.onInstalled.addListener(() => {
  console.log('Midnight Wallet extension installed')
})

restoreSession().catch(console.error)

setupMessageListener()

console.log('Midnight Wallet background service started')

export {}
