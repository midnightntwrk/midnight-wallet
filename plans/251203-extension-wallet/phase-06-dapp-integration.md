# Phase 06: dApp Integration

**Status:** Pending | **Priority:** High | **Date:** 2025-12-03

## Context

- Depends on: [Phase 05](./phase-05-balance-transactions.md)
- Enables dApps to request wallet operations
- Content script injection + window.midnight provider

## Overview

Implement content script injection, window.midnight provider API, message bridge between dApp and background, connection approval flow, and transaction signing from dApps.

## Key Insights

- Content script runs in isolated world (can't directly modify page)
- Inject provider via DOM script element
- Message flow: dApp -> injected -> content -> background
- Must handle popup for approval during page lifecycle

## Requirements

**Functional:**
- Inject `window.midnight` into all pages
- dApp can request connection (`midnight_requestAccounts`)
- dApp can request transaction signing
- Show approval popup for connections/transactions
- Emit events (accountsChanged, chainChanged)

**Non-Functional:**
- Injection <50ms after page load
- Approval popup opens <200ms
- Support multiple simultaneous dApps

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           dApp Integration Flow                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │  dApp Page (untrusted)                                                  ││
│  │  ┌────────────────────────────────────────────────────────────────────┐││
│  │  │  window.midnight.request({ method: 'midnight_sendTransaction' })   │││
│  │  └────────────────────────────────────────────────────────────────────┘││
│  │                                    │ (postMessage)                      ││
│  └────────────────────────────────────┼────────────────────────────────────┘│
│                                       ↓                                     │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │  Injected Script (provider.js - runs in page context)                  ││
│  │  - Exposes window.midnight API                                         ││
│  │  - Forwards requests via postMessage                                   ││
│  │  - Receives responses, fires events                                    ││
│  └────────────────────────────────────┼────────────────────────────────────┘│
│                                       │ (postMessage)                       │
│                                       ↓                                     │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │  Content Script (content.js - isolated world)                          ││
│  │  - Listens for page messages                                           ││
│  │  - Validates request structure                                         ││
│  │  - Forwards to background via chrome.runtime                          ││
│  └────────────────────────────────────┼────────────────────────────────────┘│
│                                       │ (chrome.runtime.sendMessage)        │
│                                       ↓                                     │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │  Background Service Worker                                              ││
│  │  - Validates origin / permissions                                       ││
│  │  - Opens popup for approval (chrome.windows.create)                    ││
│  │  - Processes approved requests                                          ││
│  │  - Sends response back to content script                               ││
│  └────────────────────────────────────────────────────────────────────────┘│
│                                       │                                     │
│                                       ↓                                     │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │  Approval Popup                                                         ││
│  │  - Shows dApp origin, requested action                                 ││
│  │  - User approves/rejects                                               ││
│  │  - Sends decision back to background                                   ││
│  └────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Provider API:**
```typescript
window.midnight = {
  request({ method, params }): Promise<any>;
  on(event, handler): void;
  removeListener(event, handler): void;
  isMidnight: true;
}
```

**Methods:**
- `midnight_requestAccounts` - Connect wallet
- `midnight_accounts` - Get connected accounts
- `midnight_sendTransaction` - Sign & submit tx
- `midnight_signMessage` - Sign arbitrary message
- `midnight_chainId` - Get current chain

## Related Files

**Create:**
- `src/content/index.ts` - Content script entry
- `src/content/provider-injector.ts` - Injects provider.js
- `src/content/message-bridge.ts` - Message forwarding
- `src/injected/provider.ts` - window.midnight API
- `src/background/dapp-handler.ts` - dApp request processing
- `src/background/approval-manager.ts` - Popup approval flow
- `src/popup/pages/approve-connection.tsx` - Connect approval
- `src/popup/pages/approve-transaction.tsx` - TX approval
- `src/popup/pages/approve-message.tsx` - Sign message approval

**Modify:**
- `public/manifest.json` - Content script config
- `vite.config.ts` - Build injected script separately
- `src/background/message-router.ts` - Add dApp handlers

## Implementation Steps

### 1. Create injected provider script
```typescript
// injected/provider.ts
const pending = new Map<string, { resolve, reject }>();

window.midnight = {
  isMidnight: true,

  request({ method, params }) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      pending.set(id, { resolve, reject });
      window.postMessage({ type: 'MIDNIGHT_REQUEST', id, method, params }, '*');
    });
  },

  on(event, handler) {
    window.addEventListener(`midnight_${event}`, (e) => handler(e.detail));
  },

  removeListener(event, handler) {
    window.removeEventListener(`midnight_${event}`, handler);
  }
};

window.addEventListener('message', (e) => {
  if (e.data?.type === 'MIDNIGHT_RESPONSE') {
    const { id, result, error } = e.data;
    const p = pending.get(id);
    if (p) {
      pending.delete(id);
      error ? p.reject(new Error(error)) : p.resolve(result);
    }
  }
});

window.dispatchEvent(new Event('midnight#initialized'));
```

### 2. Create content script injector
```typescript
// content/provider-injector.ts
export function injectProvider() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected/provider.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}
```

### 3. Create message bridge in content script
```typescript
// content/message-bridge.ts
window.addEventListener('message', async (e) => {
  if (e.data?.type !== 'MIDNIGHT_REQUEST') return;

  const { id, method, params } = e.data;
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'DAPP_REQUEST',
      origin: window.location.origin,
      method,
      params,
    });
    window.postMessage({ type: 'MIDNIGHT_RESPONSE', id, result }, '*');
  } catch (error) {
    window.postMessage({ type: 'MIDNIGHT_RESPONSE', id, error: error.message }, '*');
  }
});
```

### 4. Create dApp handler in background
```typescript
// background/dapp-handler.ts
export async function handleDappRequest(origin: string, method: string, params: any) {
  switch (method) {
    case 'midnight_requestAccounts':
      const approved = await requestApproval('connect', { origin });
      if (!approved) throw new Error('User rejected');
      return getAccounts();

    case 'midnight_sendTransaction':
      const txApproved = await requestApproval('transaction', { origin, ...params });
      if (!txApproved) throw new Error('User rejected');
      return sendTransaction(params);

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}
```

### 5. Create approval manager
```typescript
// background/approval-manager.ts
export async function requestApproval(type: string, data: any): Promise<boolean> {
  return new Promise((resolve) => {
    const popupUrl = chrome.runtime.getURL(
      `popup/index.html#/approve/${type}?data=${encodeURIComponent(JSON.stringify(data))}`
    );
    chrome.windows.create({
      url: popupUrl,
      type: 'popup',
      width: 400,
      height: 600,
    }, (window) => {
      // Listen for approval response
      pendingApprovals.set(window.id, resolve);
    });
  });
}
```

### 6. Create approval pages
```typescript
// pages/approve-connection.tsx
export function ApproveConnectionPage() {
  const { origin } = useApprovalData();
  return (
    <div className="p-4">
      <h2>Connect to {origin}?</h2>
      <p>This site wants to view your wallet address</p>
      <div className="flex gap-2 mt-4">
        <Button variant="outline" onClick={reject}>Cancel</Button>
        <Button onClick={approve}>Connect</Button>
      </div>
    </div>
  );
}
```

### 7. Update manifest for content script
```json
{
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content/index.js"],
    "run_at": "document_start"
  }],
  "web_accessible_resources": [{
    "resources": ["injected/provider.js"],
    "matches": ["<all_urls>"]
  }]
}
```

## Todo List

- [ ] Create injected/provider.ts (window.midnight)
- [ ] Create content/provider-injector.ts
- [ ] Create content/message-bridge.ts
- [ ] Create content/index.ts entry
- [ ] Create background/dapp-handler.ts
- [ ] Create background/approval-manager.ts
- [ ] Create approve-connection.tsx page
- [ ] Create approve-transaction.tsx page
- [ ] Create approve-message.tsx page
- [ ] Update manifest.json (content scripts, web resources)
- [ ] Update vite.config.ts (build injected separately)
- [ ] Add dApp routes to router
- [ ] Test connection flow E2E
- [ ] Test transaction signing E2E

## Success Criteria

- [ ] window.midnight available on all pages
- [ ] dApp can request connection
- [ ] Approval popup appears for connect
- [ ] Connected dApp can get accounts
- [ ] TX signing shows approval popup
- [ ] Events fire on account change

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Injection race condition | Medium | Inject at document_start |
| Popup blocked by browser | High | Fallback to tab-based approval |
| Origin spoofing | High | Validate sender.origin strictly |

## Security Considerations

- Validate all message origins
- Never auto-approve any request
- Show full tx details in approval
- Rate-limit requests per origin
- Log all dApp interactions

## Next Steps

After completion, proceed to [Phase 07: Settings & Polish](./phase-07-settings-polish.md).
