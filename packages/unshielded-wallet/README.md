# @midnightntwrk/wallet-sdk-unshielded-wallet

Manages unshielded tokens on the Midnight network.

## Installation

```bash
npm install @midnightntwrk/wallet-sdk-unshielded-wallet
```

## Overview

The Unshielded Wallet handles transparent token operations where transactions are publicly visible on the blockchain.
Unlike shielded transactions, unshielded operations do not use zero-knowledge proofs. This package provides:

- Public token balance tracking
- Transparent transfer transactions
- Transaction balancing for unshielded tokens
- Swap initialization and participation
- Transaction signing

## Usage

### Starting the Wallet

```typescript
import { UnshieldedWallet, createKeystore, PublicKey } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { InMemoryTransactionHistoryStorage, NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { randomBytes } from 'node:crypto';

// Configuration for the wallet
const configuration = {
  networkId: NetworkId.Undeployed, // or NetworkId.Testnet, NetworkId.Mainnet
  indexerClientConnection: {
    indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
    indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
  },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  // Where this chain hands over to ledger-v9: the schedule of a chain born on ledger-v9, as a 2.x node runs. The
  // final mainnet fork constant is not yet fixed, so a chain that hands over elsewhere states `{ v9: ... }` here.
  forks: ProtocolVersion.V9NativeForkSchedule,
};

// Create a keystore from a random unshielded seed
const seed = randomBytes(32);
const keystore = createKeystore({ kind: 'schnorr', secret: seed }, configuration.networkId);

// Create and start the wallet
const unshieldedWallet = UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(keystore));

// Start syncing with the network
await unshieldedWallet.start();
```

### Restoring from Serialized State

```typescript
// Restore a wallet from previously serialized state
const unshieldedWallet = UnshieldedWallet(configuration).restore(serializedState);
await unshieldedWallet.start();
```

### Observing State

```typescript
unshieldedWallet.state.subscribe((state) => {
  console.log('Progress:', state.progress);
  console.log('Balances:', state.balances);
});

// Or wait for sync
const syncedState = await unshieldedWallet.waitForSyncedState();
```

### Creating Transfer Transactions

```typescript
const tx = await unshieldedWallet.transferTransaction(
  [{ type: 'TOKEN_A', receiverAddress: '...', amount: 1000n }],
  ttl,
);
```

### Balancing Transactions

```typescript
// Balance a finalized transaction
const balancingTx = await unshieldedWallet.balanceFinalizedTransaction(finalizedTx);

// Balance an unbound transaction (in-place)
const balancedTx = await unshieldedWallet.balanceUnboundTransaction(unboundTx);

// Balance an unproven transaction (in-place)
const balancedUnprovenTx = await unshieldedWallet.balanceUnprovenTransaction(unprovenTx);
```

### Signing Transactions

```typescript
// Sign an unproven transaction
const signedTx = await unshieldedWallet.signUnprovenTransaction(tx, signSegment);

// Sign an unbound transaction
const signedUnboundTx = await unshieldedWallet.signUnboundTransaction(tx, signSegment);
```

### Creating Swap Offers

```typescript
const swapTx = await unshieldedWallet.initSwap(
  { TOKEN_A: 500n }, // inputs
  [{ type: 'TOKEN_B', receiverAddress, amount: 100n }], // outputs
  ttl,
);
```

## Exports

- `UnshieldedWallet` - Main wallet class
- `UnshieldedWalletState` - Wallet state type
- `KeyStore` - Key storage utilities (ledger-v9)
- Storage utilities for persistence

Variant internals are published under two subpaths, one per ledger version:

- V2 (ledger-v9) variant internals via `@midnightntwrk/wallet-sdk-unshielded-wallet/v2`
- V1 (ledger-v8) variant internals via `@midnightntwrk/wallet-sdk-unshielded-wallet/v1`

The production wallet registers both variants and hands over at `forks.v9`; `./v1` is the ledger-v8 half on its own, for
code that needs the ledger that produced ledger-v8 history. The two are not interchangeable — `./v1` has no ECDSA
support (ledger-v8 has a single signature scheme) and carries its own ledger-v8 `createKeystore`, whose secret is a
plain `Uint8Array` rather than the root export's `{kind, secret}`.

```typescript
import { V2Builder, RunningV2Variant } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v2';
```

## License

Apache-2.0
