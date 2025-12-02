# Phase 05: Balance & Transactions

**Status:** Pending | **Priority:** High | **Date:** 2025-12-03

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

- [ ] Create indexer-client.ts wrapper
- [ ] Create transaction-service.ts
- [ ] Add tx handlers to message-router.ts
- [ ] Create balance-card.tsx component
- [ ] Create transaction-list.tsx component
- [ ] Create transaction-item.tsx component
- [ ] Build home.tsx page (balance + history)
- [ ] Build send.tsx page (form + confirm)
- [ ] Build receive.tsx page (QR + copy)
- [ ] Add qr-code.tsx component
- [ ] Add send-confirm-dialog.tsx
- [ ] Create format.ts utilities
- [ ] Test balance fetch E2E
- [ ] Test send flow E2E

## Success Criteria

- [ ] Balances display correctly (3 types)
- [ ] Balance refreshes on WebSocket update
- [ ] Send shows confirmation before submit
- [ ] Send returns transaction hash
- [ ] Receive shows QR + copyable address
- [ ] Transaction history loads
- [ ] Amounts formatted correctly

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
