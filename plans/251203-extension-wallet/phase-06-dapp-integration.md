# Phase 06: dApp Integration

**Status:** Code Review - CRITICAL SECURITY ISSUES | **Priority:** High | **Date:** 2025-12-03
**Review Date:** 2025-12-03 | **Security Status:** ❌ BLOCKED - Critical vulnerabilities found

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

### Implementation (Complete)
- [x] Create injected/provider.ts (window.midnight) - **HAS CRITICAL ISSUES**
- [x] Create content/provider-injector.ts - Done (inline)
- [x] Create content/message-bridge.ts - Done (inline)
- [x] Create content/index.ts entry - Done
- [x] Create background/dapp-handler.ts - **HAS CRITICAL ISSUES**
- [x] Create background/approval-manager.ts - **HAS RACE CONDITION**
- [x] Create approve-connection.tsx page - **HAS URL PARSING ISSUE**
- [x] Create approve-transaction.tsx page - **HAS URL PARSING ISSUE**
- [x] Create approve-message.tsx page - **HAS URL PARSING ISSUE**
- [x] Update manifest.json (content scripts, web resources) - Done
- [x] Update vite.config.ts (build injected separately) - Done
- [x] Add dApp routes to router - Done

### Security Fixes (CRITICAL - Required Before Merge)
- [ ] **CRITICAL #1:** Fix wildcard postMessage in provider.ts (use window.location.origin)
- [ ] **CRITICAL #2:** Add try-catch for URL parsing in all approval pages
- [ ] **CRITICAL #4:** Add transaction validation in dapp-handler.ts
- [ ] **CRITICAL #5:** Add JSON schema validation for approval data parsing
- [ ] **HIGH #1:** Fix memory leak in pending requests cleanup
- [ ] **HIGH #4:** Add sender origin validation in message-router.ts
- [ ] **CRITICAL #3:** Add nonce-based provider verification (content script)
- [ ] **CRITICAL #6:** Implement rate limiting for dApp requests

### Testing
- [ ] Test connection flow E2E
- [ ] Test transaction signing E2E
- [ ] Test security: origin spoofing attempts
- [ ] Test security: malformed message injection
- [ ] Test memory: rapid requests don't leak
- [ ] Test race condition: approval window close during approval

## Success Criteria

### Functional
- [x] window.midnight available on all pages
- [x] dApp can request connection
- [x] Approval popup appears for connect
- [x] Connected dApp can get accounts
- [x] TX signing shows approval popup
- [ ] Events fire on account change - **NOT IMPLEMENTED**

### Security (CRITICAL)
- [ ] No wildcard postMessage usage
- [ ] All URL parsing wrapped in try-catch
- [ ] Transaction parameters validated
- [ ] JSON parsing validates schema
- [ ] Sender origin matches message origin
- [ ] Rate limiting prevents DoS
- [ ] No memory leaks in request handling
- [ ] No race conditions in approval flow

### Code Quality
- [x] Build succeeds without errors
- [x] TypeScript compiles cleanly
- [x] Bundle size acceptable (provider: 1.45KB gzipped)
- [ ] All critical security issues resolved
- [ ] E2E tests pass

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

## Code Review Summary (2025-12-03)

**Review Report:** [code-reviewer-251203-phase06-dapp-integration.md](./reports/code-reviewer-251203-phase06-dapp-integration.md)

### Implementation Status
- ✅ 12/14 implementation tasks complete (86%)
- ❌ 6 CRITICAL security vulnerabilities identified
- ❌ 4 HIGH priority issues found
- ⚠️ Event emission not implemented (accountsChanged, etc)

### Critical Security Findings
1. **Wildcard postMessage** - Message interception vulnerability (provider.ts)
2. **Unvalidated URL parsing** - Crash vector in approval pages
3. **Insufficient sender validation** - Origin spoofing possible
4. **Type coercion without validation** - Injection vulnerability
5. **Unvalidated JSON parsing** - Code injection vector
6. **No rate limiting** - DoS vulnerability

### Recommended Action
**❌ DO NOT MERGE** until critical security issues resolved.

**Fix Estimate:** 4-6 hours for critical + high priority issues

**Next Steps:**
1. Apply security fixes from review report (CRITICAL #1-6, HIGH #1,#4)
2. Add E2E tests for approval flow
3. Re-run security review
4. Then proceed to Phase 07

## Next Steps

After security fixes and re-review, proceed to [Phase 07: Settings & Polish](./phase-07-settings-polish.md).
