# Crypto Wallet Extension Architecture Research

**Date:** 2025-12-03
**Project:** Midnight Network Browser Extension Wallet
**Focus:** Security patterns, state management, dApp connectivity

---

## Executive Summary

Building a secure browser extension wallet for Midnight requires architecture balancing privacy/security with UX. Reference implementations (MetaMask, Phantom) use background service workers + content scripts + popup UI with message-based communication. Critical: encrypt key storage, isolate signing logic, validate dApp requests.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│           BROWSER EXTENSION STRUCTURE                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Background Service Worker (Manifest V3)         │  │
│  │  - Encrypted key storage (IndexedDB)             │  │
│  │  - Persistent state (wallets, sessions)          │  │
│  │  - Transaction signing logic                     │  │
│  │  - Message routing & validation                  │  │
│  └──────────────────────────────────────────────────┘  │
│              ↑                      ↑                   │
│      [chrome.runtime.  [chrome.storage.              │
│       sendMessage]      onChanged]                    │
│              ↑                      ↑                   │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Content Script (Injected into dApp)            │  │
│  │  - Listens for dApp requests                     │  │
│  │  - Forwards to background worker                 │  │
│  │  - Injects provider (window.midnight.*) object   │  │
│  └──────────────────────────────────────────────────┘  │
│              ↑                      ↓                   │
│         [postMessage]         [injection]              │
│              ↑                      ↓                   │
│  ┌──────────────────────────────────────────────────┐  │
│  │  dApp Page (untrusted)                           │  │
│  │  - Calls window.midnight.request()               │  │
│  │  - Listens for response events                    │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Popup UI (User Approval)                        │  │
│  │  - Request confirmation modal                    │  │
│  │  - Wallet management, settings                   │  │
│  │  - Session lock/unlock                           │  │
│  └──────────────────────────────────────────────────┘  │
│              ↑                      ↑                   │
│      [chrome.runtime.    [chrome.tabs.               │
│       connect]            sendMessage]               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Key Components

### 1. Background Service Worker (Core)

**Responsibilities:**
- Store encrypted private keys/seeds in IndexedDB with AES-GCM encryption
- Manage wallet state and session tokens (with TTL)
- Sign transactions securely (never expose keys)
- Validate and route dApp requests
- Emit events for popup UI updates

**Security Pattern:**
```
┌─────────────────────────────────────────┐
│  IndexedDB: Encrypted Storage           │
├─────────────────────────────────────────┤
│ plaintext_seed → AES-GCM encrypt →     │
│        (using scrypt-derived key)       │
│        → stored in IndexedDB            │
│                                         │
│ On unlock: password → scrypt → key →   │
│        decrypt → in-memory only         │
└─────────────────────────────────────────┘
```

Key practices:
- Never persist unencrypted keys
- Never log sensitive data
- Use `extractable: false` for WebCrypto keys
- Implement request rate limiting & nonce tracking

### 2. Content Script Injection

**Injected as `window.midnight`:**
```js
{
  request: (args) => Promise<response>,
  on: (event, handler) => void,
  removeListener: (event, handler) => void
}
```

**Flow:**
1. Content script injects provider object into page context
2. dApp calls `window.midnight.request({ method, params })`
3. Content script sends to background via `chrome.runtime.sendMessage()`
4. Background validates dApp origin & performs action
5. Result sent back, content script fires response event

**Validation checklist:**
- Verify caller's origin against whitelist/dApp registry
- Reject unsigned/malformed requests
- Rate-limit per-origin requests
- Timeout long-running operations (30s default)

### 3. Key Storage Strategy

**Recommended: AES-GCM with Scrypt KDF**

```
Encryption:
  password (user input)
    ↓ [scrypt: N=2^15, r=8, p=1]
  master_key (256-bit)
    ↓ [HKDF-SHA256]
  encryption_key + iv
    ↓ [AES-256-GCM]
  ciphertext + auth_tag (stored)

On unlock (every session):
  - Decrypt only into memory
  - Clear after lock/timeout
  - Never write to disk plaintext
```

**Storage options:**
- **IndexedDB:** Preferred (async, ~50MB limit)
- **chrome.storage.local:** Smaller (~10MB), synchronous
- **Avoid:** localStorage (vulnerable to XSS)

### 4. State Management

**Persistent State:**
```json
{
  "version": "1.0",
  "wallets": [
    {
      "id": "uuid",
      "name": "Primary",
      "encrypted_seed": "base64...",
      "addresses": ["midnight1abc..."],
      "derivation_path": "m/44'/0'/0'/0'",
      "created_at": 1701600000000
    }
  ],
  "settings": {
    "auto_lock_minutes": 15,
    "theme": "dark"
  }
}
```

**Ephemeral State (in-memory only):**
- Current session token & expiry
- Decrypted seed/keys (immediately after unlock)
- Transaction signing contexts

### 5. Transaction Signing Flow

```
User approves tx in dApp
    ↓
Content Script → Background: 'sign_transaction'
    ↓
Background validates:
  ✓ Is session unlocked?
  ✓ Is dApp origin whitelisted?
  ✓ Does user address match wallet?
    ↓
Popup modal shows tx details
    ↓
User clicks "Approve"
    ↓
Background retrieves in-memory key
    ↓
Signs with Midnight SDK: tx_builder.sign(key)
    ↓
Returns signed tx to content script
    ↓
Content Script emits: window.midnight_response event
    ↓
dApp submits to indexer/node
```

**Security gates:**
- Never auto-approve (always show modal)
- Display readable tx summary (amount, recipient, fees)
- Implement hardware wallet support (Ledger via USB HID)
- Sign-only operations (no key export)

### 6. dApp Injection Pattern

**Window object structure (Phantom/MetaMask compatible):**
```js
window.midnight = {
  // Connect wallet
  request({ method, params }) {
    // 'eth_requestAccounts' → ['midnight1...']
    // 'eth_sendTransaction' → 'txhash'
    // 'eth_signMessage' → 'signature'
    // 'net_version' → '1' (chain ID)
  },

  // Event subscriptions
  on(event, handler) {
    // 'accountsChanged' → [accounts]
    // 'chainChanged' → 'chainId'
    // 'disconnect' → null
    // 'connect' → { chainId, accounts }
  },

  // Wallet metadata
  isMetaMask: false,
  isMidnight: true,
  version: '1.0.0'
}

// Also support EIP-6963 (wallet discovery)
// window.dispatchEvent(new Event('eip6963:requestProvider'))
```

### 7. Session & Lock Management

**Session Model:**
```
User unlock with password
    ↓
Generate session_token = crypto.randomUUID()
    ↓
Store: token + expiry_time (now + 15min)
    ↓
Background checks token on every request
    ↓
If expired OR user locks → session.clear()
    ↓
Next dApp request requires unlock again
```

**Auto-lock:**
- Timer resets on activity (requests, popup interaction)
- Configurable timeout (5-60 min)
- Manual lock button in popup
- Lock on browser/tab close

### 8. Security Best Practices

| Threat | Mitigation |
|--------|-----------|
| XSS in dApp | Origin validation, read-only injection |
| Key theft (malware) | Encrypt + extractable:false, sign-only ops |
| Phishing | Show tx details, domain warnings |
| Replay attacks | Use nonces from Midnight SDK |
| Man-in-middle | HTTPS enforcement, CSP headers |
| Keylogging | Hardware wallet support |

---

## Architecture Decisions

**Manifest V3 (Required for modern Chrome):**
- Service workers mandatory (not background pages)
- Stricter CSP, no eval()
- Message-based communication only
- Limited host permissions

**Encrypted IndexedDB vs. Password Manager:**
- Recommended: App-level encryption (control over UX)
- Avoid: Browser password manager (treats like login)

**Popup vs. Side Panel:**
- Popup: Standard, compatible (240px wide limit)
- Side panel: Better UX but Chrome 116+ only

**dApp Injection Method:**
- Content script injects into `window` (secure sandbox)
- Avoid: Injecting via CSP-hostile script tags
- Use: `document.documentElement.appendChild(script)` in content script

---

## Reference Implementations

- **MetaMask:** github.com/MetaMask/metamask-extension (Manifest V3, React)
- **Phantom:** github.com/phantom/wallet-sdk (Multi-chain, Wallet Standard)
- **Brave Wallet:** github.com/brave/brave-browser (Built-in, no extension)

---

## Unresolved Questions

1. Hardware wallet support (Ledger Live vs. direct USB HID)?
2. Mobile app sync (same key store across devices)?
3. Multi-sig wallet support in extension?
4. Backup/recovery UX for seed phrases (paper, encrypted cloud)?
5. dApp registry/whitelist strategy (auto-whitelist first use or curated)?

