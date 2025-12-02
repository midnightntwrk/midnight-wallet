# Phase 02: Background Service Worker

**Status:** ✅ Complete (w/ warnings) | **Priority:** Critical | **Date:** 2025-12-03

## Context

- Depends on: [Phase 01](./phase-01-project-setup.md)
- Core security layer - handles all sensitive operations
- Manifest V3 requires service worker (not background page)

## Overview

Implement background service worker for encrypted key storage, session management, and message routing. This is the security core - private keys never leave this context.

## Key Insights

- Service workers can terminate unexpectedly (persist state to IndexedDB)
- Use AES-GCM with scrypt KDF for encryption
- Session tokens for unlock state (TTL-based)
- All popup/content script communication via chrome.runtime

## Requirements

**Functional:**
- Store encrypted seeds in IndexedDB
- Decrypt on unlock (password + scrypt)
- Maintain session state with auto-lock
- Route messages from popup/content scripts

**Non-Functional:**
- Keys never in plaintext on disk
- Session timeout configurable (5-60 min)
- Survive service worker restarts

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Background Service Worker                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │   Crypto    │  │   Storage   │  │   Session   │ │
│  │   Service   │  │   Service   │  │   Manager   │ │
│  │             │  │             │  │             │ │
│  │ - encrypt   │  │ - IndexedDB │  │ - token     │ │
│  │ - decrypt   │  │ - get/set   │  │ - expiry    │ │
│  │ - scrypt    │  │ - wallets   │  │ - lock      │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
│           │              │               │          │
│           └──────────────┴───────────────┘          │
│                          │                          │
│  ┌───────────────────────┴───────────────────────┐ │
│  │            Message Router                      │ │
│  │  - handles: popup, content script, dApp       │ │
│  │  - validates: origin, session, permissions    │ │
│  └───────────────────────────────────────────────┘ │
│                          │                          │
└──────────────────────────┼──────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ↓                  ↓                  ↓
   [Popup UI]      [Content Script]     [IndexedDB]
```

## Related Files

**Create:**
- `src/background/index.ts` - Entry point
- `src/background/crypto-service.ts` - Encryption/decryption
- `src/background/storage-service.ts` - IndexedDB wrapper
- `src/background/session-manager.ts` - Lock/unlock state
- `src/background/message-router.ts` - Message handling
- `src/background/types.ts` - Shared types

## Implementation Steps

### 1. Create crypto service
```typescript
// crypto-service.ts
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1 };

export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return crypto.subtle.importKey('raw', derivedBits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(data: string, key: CryptoKey): Promise<EncryptedData> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(data);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return { iv: arrayToBase64(iv), ciphertext: arrayToBase64(ciphertext) };
}
```

### 2. Create IndexedDB storage service
```typescript
// storage-service.ts
const DB_NAME = 'midnight-wallet';
const STORE_NAME = 'wallets';

export async function openDB(): Promise<IDBDatabase> { ... }
export async function saveWallet(wallet: EncryptedWallet): Promise<void> { ... }
export async function getWallets(): Promise<EncryptedWallet[]> { ... }
export async function deleteWallet(id: string): Promise<void> { ... }
```

### 3. Create session manager
```typescript
// session-manager.ts
interface Session {
  token: string;
  expiresAt: number;
  walletId: string;
  decryptedSeed?: Uint8Array; // In-memory only
}

let currentSession: Session | null = null;

export function isUnlocked(): boolean { ... }
export function unlock(password: string, walletId: string): Promise<boolean> { ... }
export function lock(): void { ... }
export function refreshSession(): void { ... }
```

### 4. Create message router
```typescript
// message-router.ts
type MessageType =
  | 'UNLOCK' | 'LOCK' | 'GET_STATE'
  | 'CREATE_WALLET' | 'IMPORT_WALLET' | 'GET_WALLETS'
  | 'SIGN_TRANSACTION' | 'GET_ADDRESS';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});
```

### 5. Setup auto-lock timer
```typescript
let lockTimer: number | null = null;

function resetLockTimer(minutes: number) {
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = setTimeout(() => lock(), minutes * 60 * 1000);
}
```

### 6. Wire up entry point
```typescript
// index.ts
import './message-router';
console.log('Midnight Wallet background service started');
```

## Todo List

- [x] Create crypto-service.ts (AES-GCM + PBKDF2)
- [x] Create storage-service.ts (IndexedDB wrapper)
- [x] Create session-manager.ts (lock/unlock)
- [x] Create message-router.ts (chrome.runtime handler)
- [x] Create types.ts (shared interfaces)
- [x] Wire up background/index.ts
- [x] Add auto-lock timer
- [x] Test encrypt/decrypt cycle
- [x] Test session persistence across SW restart

## Success Criteria

- [x] Service worker starts without errors
- [x] Can store/retrieve encrypted data in IndexedDB
- [x] Encrypt/decrypt round-trip works
- [x] Session survives SW restart (via IndexedDB)
- [x] Auto-lock triggers after timeout
- [x] Messages route correctly from popup

## Code Review

**Report:** [code-reviewer-251203-phase02-bgsw.md](./reports/code-reviewer-251203-phase02-bgsw.md)

**Summary:**
- ✅ All Phase 02 criteria met
- ✅ TypeScript compilation passes
- ⚠️ 5 High Priority warnings (security/performance)
- ⚠️ 8 Medium/Low priority improvements
- 🎯 Proceed to Phase 03, address warnings before production (Phase 08)

**Critical Actions Before Production:**
1. Increase PBKDF2 iterations to 600k (OWASP 2023)
2. Remove console.log statements
3. Add BIP39 seed phrase validation
4. Refactor message-router.ts (<200 lines)
5. Add origin validation for dApp messages (Phase 06)

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| SW termination loses session | High | Persist token to storage, decrypt on wake |
| WebCrypto API differences | Low | Use standard algorithms only |
| IndexedDB quota | Low | Wallet data is small (<1MB) |

## Security Considerations

- Never log decrypted seeds
- Use `extractable: false` for CryptoKey
- Clear decrypted data on lock immediately
- Validate message origins
- Rate-limit unlock attempts

## Next Steps

After completion, proceed to [Phase 03: Popup UI Core](./phase-03-popup-ui-core.md).
