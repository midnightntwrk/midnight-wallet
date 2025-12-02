# Phase 04: Wallet Management

**Status:** Code Review Complete - CRITICAL ISSUES FOUND | **Priority:** Critical | **Date:** 2025-12-03
**Review:** [Code Review Report](./reports/code-reviewer-251203-phase04-wallet-mgmt.md)

## Context

- Depends on: [Phase 02](./phase-02-background-service.md), [Phase 03](./phase-03-popup-ui-core.md)
- Core wallet functionality - create, import, derive accounts
- Integrates with `@midnight-ntwrk/wallet-sdk-hd` package

## Overview

Implement wallet creation (seed generation), import (seed phrase restore), and HD account derivation. All key operations in background service; UI only handles user input and display.

## Key Insights

- Use SDK's HD wallet for BIP-39/BIP-32 derivation
- 24-word mnemonic for Midnight (128-bit entropy)
- Seed encrypted with user password before storage
- Account derivation: `m/44'/0'/0'/0'/n`

## Requirements

**Functional:**
- Generate new 24-word seed phrase
- Import existing seed phrase (validate checksum)
- Derive multiple accounts from seed
- Display seed for backup (with confirmation)
- Delete wallet (with confirmation)

**Non-Functional:**
- Seed generation uses CSPRNG
- Seed display requires re-authentication
- Account derivation <100ms

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Wallet Management Flow                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │  Create     │    │  Import     │    │  Derive Account │  │
│  │  Wallet UI  │    │  Wallet UI  │    │  UI             │  │
│  └──────┬──────┘    └──────┬──────┘    └────────┬────────┘  │
│         │                  │                     │           │
│         ↓                  ↓                     ↓           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Background Service                       │   │
│  │  ┌──────────────────────────────────────────────┐    │   │
│  │  │            Wallet Service                     │    │   │
│  │  │  - generateSeed() → 24 words                  │    │   │
│  │  │  - importSeed(words) → validate + store       │    │   │
│  │  │  - deriveAccount(index) → address             │    │   │
│  │  │  - exportSeed(password) → words (re-auth)     │    │   │
│  │  └──────────────────────────────────────────────┘    │   │
│  │                        │                              │   │
│  │                        ↓                              │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │  @midnight-ntwrk/wallet-sdk-hd                 │  │   │
│  │  │  - generateMnemonic()                          │  │   │
│  │  │  - mnemonicToSeed()                            │  │   │
│  │  │  - deriveKey(seed, path)                       │  │   │
│  │  └────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Related Files

**Create:**
- `src/background/wallet-service.ts` - Wallet CRUD operations
- `src/popup/pages/onboarding/create-wallet.tsx` - New wallet flow
- `src/popup/pages/onboarding/import-wallet.tsx` - Import flow
- `src/popup/pages/onboarding/backup-seed.tsx` - Seed display
- `src/popup/pages/onboarding/confirm-seed.tsx` - Seed verification
- `src/popup/pages/onboarding/set-password.tsx` - Password creation
- `src/popup/pages/manage-accounts.tsx` - Account list
- `src/popup/components/seed-phrase-input.tsx` - 24-word input grid
- `src/popup/components/seed-phrase-display.tsx` - Seed display grid

**Modify:**
- `src/background/message-router.ts` - Add wallet handlers
- `src/popup/router.tsx` - Add onboarding routes
- `src/store/wallet-store.ts` - Add wallet list

## Implementation Steps

### 1. Create wallet service in background
```typescript
// background/wallet-service.ts
import { generateMnemonic, mnemonicToSeed } from '@midnight-ntwrk/wallet-sdk-hd';

export async function createWallet(password: string): Promise<{
  id: string;
  mnemonic: string[];
}> {
  const mnemonic = generateMnemonic(256); // 24 words
  const seed = await mnemonicToSeed(mnemonic);
  const encryptedSeed = await encrypt(seed, password);
  const wallet = { id: crypto.randomUUID(), encryptedSeed, createdAt: Date.now() };
  await saveWallet(wallet);
  return { id: wallet.id, mnemonic: mnemonic.split(' ') };
}

export async function importWallet(mnemonic: string[], password: string): Promise<string> {
  if (!validateMnemonic(mnemonic.join(' '))) throw new Error('Invalid mnemonic');
  const seed = await mnemonicToSeed(mnemonic.join(' '));
  const encryptedSeed = await encrypt(seed, password);
  const wallet = { id: crypto.randomUUID(), encryptedSeed, createdAt: Date.now() };
  await saveWallet(wallet);
  return wallet.id;
}

export async function deriveAccount(walletId: string, index: number): Promise<string> {
  const session = getSession();
  if (!session) throw new Error('Wallet locked');
  const path = `m/44'/0'/0'/0'/${index}`;
  const key = deriveKey(session.seed, path);
  return formatAddress(key.publicKey);
}
```

### 2. Add message handlers
```typescript
// message-router.ts additions
case 'CREATE_WALLET':
  return createWallet(payload.password);
case 'IMPORT_WALLET':
  return importWallet(payload.mnemonic, payload.password);
case 'DERIVE_ACCOUNT':
  return deriveAccount(payload.walletId, payload.index);
case 'EXPORT_SEED':
  return exportSeed(payload.password);
```

### 3. Create onboarding UI flow
```
/welcome → /create-wallet → /backup-seed → /confirm-seed → /set-password → /home
                ↓
         /import-wallet → /set-password → /home
```

### 4. Build seed phrase input component
```typescript
// components/seed-phrase-input.tsx
export function SeedPhraseInput({ onComplete }: { onComplete: (words: string[]) => void }) {
  const [words, setWords] = useState<string[]>(Array(24).fill(''));
  // 4x6 grid of inputs
  // Paste detection (splits by space/comma)
  // Autocomplete from BIP-39 wordlist
}
```

### 5. Build seed phrase display component
```typescript
// components/seed-phrase-display.tsx
export function SeedPhraseDisplay({ words }: { words: string[] }) {
  // 4x6 grid display
  // Copy all button
  // Warning banner
}
```

### 6. Create confirmation step
User selects random words to verify backup.

## Todo List

- [x] Create wallet-service.ts with SDK integration
- [x] Add wallet handlers to message-router.ts
- [x] Create /welcome page
- [x] Create /create-wallet page
- [x] Create /import-wallet page
- [x] Create /backup-seed page (display)
- [x] Create /confirm-seed page (verify)
- [x] Create /set-password page
- [x] Create seed-phrase-input.tsx component
- [x] Create seed-phrase-display.tsx component
- [x] Add onboarding routes to router
- [ ] **[BLOCKER]** Fix CRITICAL security issues (see review report)
- [ ] Test create wallet flow E2E
- [ ] Test import wallet flow E2E

## Success Criteria

- [x] Can generate new 24-word seed
- [x] Can import existing seed (valid checksum)
- [x] Rejects invalid seed phrases
- [x] Password encrypts seed correctly
- [~] Derived account returns valid address (**PARTIAL** - wrong Bech32m format)
- [ ] Seed export requires re-auth (**FAILING** - missing re-authentication)

## Code Review Results

**Date:** 2025-12-03
**Status:** ⚠️ CRITICAL ISSUES FOUND - DO NOT MERGE

**Critical Issues (MUST FIX):**
1. Seed phrase memory leak - never cleared from memory
2. Seed visible in dev tools console/messages
3. No re-authentication for seed export
4. PBKDF2 iterations too low (100k vs 600k OWASP)
5. Weak password validation (length-only)
6. Session restore without integrity validation
7. Missing Bech32m address format (incompatible with Midnight)

**Build Status:** ✅ TypeScript compiles, builds successfully
**Bundle Size:** 268.57 KB popup, 80.09 KB background

**Full Report:** [./reports/code-reviewer-251203-phase04-wallet-mgmt.md](./reports/code-reviewer-251203-phase04-wallet-mgmt.md)

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| SDK not browser-compatible | High | Test WASM early, may need polyfills |
| Weak password allowed | Medium | Enforce minimum strength |
| Seed copied insecurely | High | Warn user, no clipboard on mobile |

## Security Considerations

- Seed displayed only once after creation
- Seed export requires password re-entry
- Clear seed from memory after encryption
- Disable screenshots during seed display (if possible)
- Warn about clipboard risks

## Next Steps

After completion, proceed to [Phase 05: Balance & Transactions](./phase-05-balance-transactions.md).
