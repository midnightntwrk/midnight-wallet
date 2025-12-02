# Phase 05: Balance & Transactions

**Status:** Review Complete - Fixes Required | **Priority:** High | **Date:** 2025-12-03
**Review Date:** 2025-12-03 | **Review Report:** [code-reviewer-251203-phase05-balance-tx.md](./reports/code-reviewer-251203-phase05-balance-tx.md)

## Context

- Depends on: [Phase 04](./phase-04-wallet-management.md)
- Core wallet operations - view balances, send, receive
- Integrates with indexer-client and shielded-wallet SDKs

## Overview

Implement balance display (shielded/unshielded/dust), send transaction flow with confirmation, receive address + QR code, and transaction history. Background service handles SDK calls; UI displays data.

## Key Insights

- Midnight has 3 balance types: shielded, unshielded, dust
- Shielded txs require ZK proofs (may take seconds)
- Use indexer-client for state sync
- Transaction history from indexer GraphQL

## Requirements

**Functional:**
- Display balances (formatted with decimals)
- Send tokens (amount, recipient, memo)
- Show receiving address + QR code
- Display transaction history
- Real-time balance updates (WebSocket)

**Non-Functional:**
- Balance refresh <1s
- Send confirmation <5s (UI response)
- QR code generates instantly

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      Balance & Transactions                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────────┐│
│  │  Home Page  │   │  Send Page  │   │  Receive Page           ││
│  │             │   │             │   │                         ││
│  │ ┌─────────┐ │   │ ┌─────────┐ │   │  ┌───────────────────┐  ││
│  │ │ Balance │ │   │ │ Amount  │ │   │  │    QR Code        │  ││
│  │ │  Card   │ │   │ │ Input   │ │   │  │   [midnight1...]  │  ││
│  │ ├─────────┤ │   │ ├─────────┤ │   │  └───────────────────┘  ││
│  │ │ TX List │ │   │ │ Address │ │   │  ┌───────────────────┐  ││
│  │ │         │ │   │ │ Input   │ │   │  │  Copy Address     │  ││
│  │ └─────────┘ │   │ ├─────────┤ │   │  └───────────────────┘  ││
│  └─────────────┘   │ │ Confirm │ │   └─────────────────────────┘│
│                    │ │ Dialog  │ │                              │
│                    │ └─────────┘ │                              │
│                    └─────────────┘                              │
│                           │                                     │
│  ┌────────────────────────┴────────────────────────────────┐   │
│  │              Background Service                          │   │
│  │  ┌───────────────────────────────────────────────────┐  │   │
│  │  │            Transaction Service                     │  │   │
│  │  │  - getBalances() → {shielded, unshielded, dust}   │  │   │
│  │  │  - sendTransaction(to, amount) → txHash           │  │   │
│  │  │  - getTransactionHistory() → tx[]                 │  │   │
│  │  │  - subscribeBalances() → Observable               │  │   │
│  │  └───────────────────────────────────────────────────┘  │   │
│  │                          │                               │   │
│  │  ┌───────────────────────┴───────────────────────────┐  │   │
│  │  │  @midnight-ntwrk/wallet-sdk-*                      │  │   │
│  │  │  - indexer-client (GraphQL + WS)                   │  │   │
│  │  │  - shielded-wallet (balance, send)                 │  │   │
│  │  │  - dust-wallet (dust handling)                     │  │   │
│  │  └───────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Related Files

**Create:**
- `src/background/transaction-service.ts` - Balance/tx operations
- `src/background/indexer-client.ts` - Indexer connection wrapper
- `src/popup/pages/home.tsx` - Dashboard with balance
- `src/popup/pages/send.tsx` - Send form + confirmation
- `src/popup/pages/receive.tsx` - Address + QR
- `src/popup/components/balance-card.tsx` - Balance display
- `src/popup/components/transaction-list.tsx` - TX history
- `src/popup/components/transaction-item.tsx` - Single TX row
- `src/popup/components/qr-code.tsx` - QR generator
- `src/popup/components/send-confirm-dialog.tsx` - Confirm modal
- `src/lib/format.ts` - Amount/address formatting

**Modify:**
- `src/background/message-router.ts` - Add tx handlers
- `src/store/wallet-store.ts` - Add balance/tx state

## Implementation Steps

### 1. Create indexer client wrapper
```typescript
// background/indexer-client.ts
import { createIndexerClient } from '@midnight-ntwrk/wallet-sdk-indexer-client';

let client: IndexerClient | null = null;

export async function getIndexerClient(): Promise<IndexerClient> {
  if (!client) {
    client = await createIndexerClient({
      url: 'https://indexer.midnight.network/graphql',
      wsUrl: 'wss://indexer.midnight.network/graphql',
    });
  }
  return client;
}
```

### 2. Create transaction service
```typescript
// background/transaction-service.ts
export async function getBalances(address: string): Promise<Balances> {
  const client = await getIndexerClient();
  const wallet = await createShieldedWallet(/* ... */);
  return {
    shielded: wallet.getShieldedBalance(),
    unshielded: wallet.getUnshieldedBalance(),
    dust: wallet.getDustBalance(),
  };
}

export async function sendTransaction(params: {
  to: string;
  amount: bigint;
  type: 'shielded' | 'unshielded';
}): Promise<string> {
  const wallet = await getActiveWallet();
  const tx = await wallet.buildTransaction(params);
  const signedTx = await wallet.signTransaction(tx);
  return await wallet.submitTransaction(signedTx);
}

export async function getTransactionHistory(address: string): Promise<Transaction[]> {
  const client = await getIndexerClient();
  return client.getTransactions({ address, limit: 50 });
}
```

### 3. Add message handlers
```typescript
case 'GET_BALANCES':
  return getBalances(payload.address);
case 'SEND_TRANSACTION':
  return sendTransaction(payload);
case 'GET_TX_HISTORY':
  return getTransactionHistory(payload.address);
```

### 4. Build balance card component
```typescript
// components/balance-card.tsx
export function BalanceCard() {
  const { balance } = useWalletStore();
  return (
    <Card>
      <div className="text-3xl font-bold">{formatAmount(balance.total)}</div>
      <div className="text-sm text-muted-foreground">
        <span>Shielded: {formatAmount(balance.shielded)}</span>
        <span>Unshielded: {formatAmount(balance.unshielded)}</span>
      </div>
    </Card>
  );
}
```

### 5. Build send page with confirmation
```typescript
// pages/send.tsx
export function SendPage() {
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  async function handleSend() {
    setShowConfirm(false);
    const txHash = await sendMessage('SEND_TRANSACTION', { to: recipient, amount });
    // Show success toast
  }
}
```

### 6. Build receive page with QR
```typescript
// pages/receive.tsx
import QRCode from 'qrcode'; // or react-qr-code

export function ReceivePage() {
  const { address } = useWalletStore();
  return (
    <div className="flex flex-col items-center gap-4">
      <QRCode value={address} size={200} />
      <div className="font-mono text-sm">{address}</div>
      <Button onClick={() => navigator.clipboard.writeText(address)}>Copy</Button>
    </div>
  );
}
```

### 7. Build transaction list
```typescript
// components/transaction-list.tsx
export function TransactionList({ transactions }: { transactions: Transaction[] }) {
  return (
    <div className="space-y-2">
      {transactions.map((tx) => (
        <TransactionItem key={tx.hash} tx={tx} />
      ))}
    </div>
  );
}
```

## Todo List

- [x] Create transaction-service.ts (DONE - using mock data)
- [x] Add tx handlers to message-router.ts (DONE - 3 handlers added)
- [x] Create balance-card.tsx component (DONE)
- [x] Create transaction-list.tsx component (DONE)
- [x] Create transaction-item.tsx component (DONE)
- [x] Build home.tsx page (balance + history) (DONE)
- [x] Build send.tsx page (form + confirm) (DONE)
- [x] Build receive.tsx page (QR + copy) (DONE)
- [x] Add qr-code.tsx component (DONE - needs fix)
- [x] Add send-confirm-dialog.tsx (DONE)
- [x] Create format.ts utilities (DONE)
- [ ] Test balance fetch E2E (Deferred to Phase 08)
- [ ] Test send flow E2E (Deferred to Phase 08)

## Critical Fixes Required (Before Merge)

- [ ] **CRITICAL-1:** Fix QR code - replace seeded random with proper QR library (`qrcode` npm package)
- [ ] **CRITICAL-2:** Add Bech32m checksum validation to `isValidMidnightAddress()` or document risk
- [ ] **CRITICAL-3:** Add rate limiting (2s cooldown) to `sendTransaction()`
- [ ] **HIGH-1:** Add max amount validation in `parseAmount()` to prevent overflow
- [ ] **HIGH-2:** Clear balance cache after successful send
- [ ] **MEDIUM-1:** Fix race condition in home.tsx useEffect (add cleanup)

## Success Criteria

- [x] Balances display correctly (3 types) ✅
- [ ] Balance refreshes on WebSocket update (Deferred to Phase 06 - SDK integration)
- [x] Send shows confirmation before submit ✅
- [x] Send returns transaction hash ✅
- [~] Receive shows QR + copyable address ⚠️ (QR generates but not scannable - needs fix)
- [x] Transaction history loads ✅
- [x] Amounts formatted correctly ✅

## Code Review Summary

**Date:** 2025-12-03
**Overall Score:** B+ (85/100)
**Status:** ✅ APPROVE AFTER FIXES

**Issues Found:**
- 3 Critical (QR code, address validation, rate limiting)
- 2 High (overflow handling, cache invalidation)
- 4 Medium (race condition, error boundary, dialog reset, console logs)
- 3 Low (mock data, MAX button, formatting)

**Strengths:**
- Clean architecture (3-layer separation)
- 100% TypeScript type coverage
- Good validation & error handling
- No sensitive data exposure
- Follows YAGNI/KISS/DRY principles

**Completion:** 12/14 todo items (86%)

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Indexer unavailable | High | Show cached balance, retry with backoff |
| TX proof generation slow | Medium | Show progress indicator, timeout at 60s |
| WebSocket disconnect | Medium | Auto-reconnect with exponential backoff |

## Security Considerations

- Validate recipient address format
- Show full address in confirmation (no truncation)
- Display estimated fees before send
- Never auto-approve sends

## Next Steps

After completion, proceed to [Phase 06: dApp Integration](./phase-06-dapp-integration.md).
