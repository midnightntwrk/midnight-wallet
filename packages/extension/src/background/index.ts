import { setupMessageListener } from './message-router'
import { restoreSession } from './session-manager'
import { setupApprovalListener } from './approval-manager'

chrome.runtime.onInstalled.addListener(() => {
  console.log('Nocturne Wallet extension installed')
})

restoreSession().catch(console.error)

setupMessageListener()
setupApprovalListener()

console.log('Nocturne Wallet background service started')

export {}
