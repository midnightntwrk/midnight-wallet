# @midnight-ntwrk/wallet-sdk-indexer-client

Client for communicating with the Midnight indexer service.

## Installation

```bash
npm install @midnight-ntwrk/wallet-sdk-indexer-client
```

## Overview

This package provides a GraphQL-based client for interacting with the Midnight indexer service. The indexer aggregates
blockchain data and provides efficient access to:

- **Subscriptions** for real-time event streaming:
  - Shielded transactions (Zswap)
  - Unshielded transactions
  - Zswap events
  - Dust ledger events

- **Queries** for fetching blockchain data:
  - Block information (height, hash, timestamp)
  - Ledger parameters (including cost model)
  - Connection management

## Usage

### Subscriptions

Subscribe to real-time events from the indexer:

```typescript
import {
  ShieldedTransactions,
  UnshieldedTransactions,
  ZswapEvents,
  DustLedgerEvents,
} from '@midnight-ntwrk/wallet-sdk-indexer-client';

// Subscribe to shielded transaction events
// Subscribe to unshielded transaction events
// Subscribe to Zswap events
// Subscribe to dust ledger events
```

### Queries

Query blockchain data:

```typescript
import { BlockHash } from '@midnight-ntwrk/wallet-sdk-indexer-client';

// Query block information including:
// - Block height
// - Block hash
// - Ledger parameters (cost model, etc.)
// - Timestamp
```

## Exports

### Default Export

- GraphQL queries: `Connect`, `Disconnect`, `BlockHash`
- GraphQL subscriptions: `ShieldedTransactions`, `UnshieldedTransactions`, `ZswapEvents`, `DustLedgerEvents`
- Generated GraphQL types

### Effect Submodule (`/effect`)

Effect.ts-based implementation for functional programming patterns:

```typescript
import {
  Query,
  Subscription,
  QueryClient,
  SubscriptionClient,
  HttpQueryClient,
  WsSubscriptionClient,
} from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
```

## License

Apache-2.0
