# @midnight-ntwrk/wallet-sdk-prover-client

Client for interacting with the Midnight ZK proof generation service.

## Installation

```bash
npm install @midnight-ntwrk/wallet-sdk-prover-client
```

## Overview

This package provides a client for submitting transactions to a Proof Server that generates zero-knowledge proofs. It is
used to finalize shielded transactions by converting unproven transactions into proven ones.

## Usage

### Basic Usage

```typescript
import { HttpProverClient } from '@midnight-ntwrk/wallet-sdk-prover-client';

// Initialize the client with the Proof Server URL
const proverClient = new HttpProverClient({
  serverUrl: 'http://localhost:6300',
});

// Prove an unproven transaction
const provenTransaction = await proverClient.proveTransaction(unprovenTransaction);
```

### With Custom Cost Model

```typescript
const provenTransaction = await proverClient.proveTransaction(unprovenTransaction, customCostModel);
```

## API

### HttpProverClient

```typescript
class HttpProverClient {
  constructor(config: { serverUrl: string });

  proveTransaction<S extends Signaturish, B extends Bindingish>(
    transaction: Transaction<S, PreProof, B>,
    costModel?: CostModel,
  ): Promise<Transaction<S, Proof, B>>;
}
```

## Exports

### Default Export

- `HttpProverClient` - HTTP client for the Proof Server

### Effect Submodule (`/effect`)

Effect.ts-based implementation:

```typescript
import { ProverClient, HttpProverClient } from '@midnight-ntwrk/wallet-sdk-prover-client/effect';
```

## Error Handling

The client may throw the following errors:

- `ClientError` - Issues with the provided transaction or connection problems
- `ServerError` - Internal server errors or connection failures
- `InvalidProtocolSchemeError` - Invalid URL scheme in configuration

## License

Apache-2.0
