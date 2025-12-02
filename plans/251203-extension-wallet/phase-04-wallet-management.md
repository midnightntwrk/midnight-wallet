# Phase 04: Wallet Management

**Status:** Pending | **Priority:** Critical | **Date:** 2025-12-03

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

- [ ] Create wallet-service.ts with SDK integration
- [ ] Add wallet handlers to message-router.ts
- [ ] Create /welcome page
- [ ] Create /create-wallet page
- [ ] Create /import-wallet page
- [ ] Create /backup-seed page (display)
- [ ] Create /confirm-seed page (verify)
- [ ] Create /set-password page
- [ ] Create seed-phrase-input.tsx component
- [ ] Create seed-phrase-display.tsx component
- [ ] Add onboarding routes to router
- [ ] Test create wallet flow E2E
- [ ] Test import wallet flow E2E

## Success Criteria

- [ ] Can generate new 24-word seed
- [ ] Can import existing seed (valid checksum)
- [ ] Rejects invalid seed phrases
- [ ] Password encrypts seed correctly
- [ ] Derived account returns valid address
- [ ] Seed export requires re-auth

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
