# @midnight-ntwrk/wallet-sdk-node-client

Client for communicating with the Midnight blockchain node.

## Installation

```bash
npm install @midnight-ntwrk/wallet-sdk-node-client
```

## Overview

This package provides a client for interacting with the Midnight blockchain node using Polkadot.js APIs. It handles:

- RPC communication with the node
- Transaction submission and tracking
- Blockchain state queries
- Type-safe interactions via generated types

## Usage

### Basic Usage

```typescript
import { PolkadotNodeClient, makeConfig } from '@midnight-ntwrk/wallet-sdk-node-client';

// Initialize the client
const config = makeConfig({ endpoint: 'ws://localhost:9944' });
const client = await PolkadotNodeClient.init(config);

// Submit a transaction and wait for finalization
const result = await client.sendMidnightTransactionAndWait(serializedTransaction, 'Finalized');

// Clean up
await client.close();
```

### Tracking Submission Events

```typescript
// Get an observable of submission events
const events$ = client.sendMidnightTransaction(serializedTransaction);

events$.subscribe({
  next: (event) => {
    switch (event._tag) {
      case 'Submitted':
        console.log('Transaction submitted');
        break;
      case 'InBlock':
        console.log('Transaction in block:', event.blockHash);
        break;
      case 'Finalized':
        console.log('Transaction finalized');
        break;
    }
  },
});
```

## Exports

### Default Export

- `PolkadotNodeClient` - Main client class for node communication
- `Config` - Configuration type
- `makeConfig` - Configuration factory function
- `DEFAULT_CONFIG` - Default configuration values

### Effect Submodule (`/effect`)

Effect.ts-based implementation for functional programming patterns:

```typescript
import { NodeClient, PolkadotNodeClient } from '@midnight-ntwrk/wallet-sdk-node-client/effect';
```

### Testing Submodule (`/testing`)

Testing utilities and mocks:

```typescript
import { ... } from '@midnight-ntwrk/wallet-sdk-node-client/testing';
```

## License

Apache-2.0
