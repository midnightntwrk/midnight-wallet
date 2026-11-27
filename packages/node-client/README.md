# @midnightntwrk/wallet-sdk-node-client

Client for communicating with the Midnight blockchain node.

## Installation

```bash
npm install @midnightntwrk/wallet-sdk-node-client
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
import { PolkadotNodeClient, makeConfig } from '@midnightntwrk/wallet-sdk-node-client';

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
import { NodeClient, PolkadotNodeClient } from '@midnightntwrk/wallet-sdk-node-client/effect';
```

### Testing Submodule (`/testing`)

Testing utilities and mocks:

```typescript
import { ... } from '@midnightntwrk/wallet-sdk-node-client/testing';
```

The entry also exports `TestTransactions`, which needs the optional peer dependencies `@effect/platform`,
`@midnightntwrk/ledger-v9`, `@midnightntwrk/wallet-sdk-prover-client`, `tar-stream` and `testcontainers`. Importing
anything from `/testing` loads it, so install those even to use only `FakePolkadotNode`.

`FakePolkadotNode` stands in for `@polkadot/api` in unit tests, so a `PolkadotNodeClient`, or anything built on one,
submits to a node whose answers the test sets. Each test file shares one node between its mock and its tests (under
vitest's default per-file isolation):

```typescript
import { FakePolkadotNode } from '@midnightntwrk/wallet-sdk-node-client/testing';

vi.mock(
  '@polkadot/api',
  async () => (await import('@midnightntwrk/wallet-sdk-node-client/testing')).FakePolkadotNode.shared.module,
);

const node = FakePolkadotNode.shared;
const result = FakePolkadotNode.submissionResult;

beforeEach(() => node.reset());

it('fails when the pool reports the transaction invalid', async () => {
  node.reportStatuses([result('isReady'), result('isInvalid')]); // or node.refuseSubmission(error), node.failCalls()
  // submit through a client built on `new URL('ws://127.0.0.1:9944')`, then assert on how it ended
});
```

## License

Apache-2.0
