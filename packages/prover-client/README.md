# @midnightntwrk/wallet-sdk-prover-client

Client for interacting with the Midnight ZK proof generation service.

## Installation

```bash
npm install @midnightntwrk/wallet-sdk-prover-client
```

## Overview

This package provides a client for submitting transactions to a Proof Server that generates zero-knowledge proofs. It is
used to finalize shielded transactions by converting unproven transactions into proven ones.

## Usage

### Basic Usage

```typescript
import { HttpProverClient } from '@midnightntwrk/wallet-sdk-prover-client';

// Initialize the client with the Proof Server URL
const proverClient = new HttpProverClient({
  url: 'http://localhost:6300',
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
  constructor(config: {
    url: string;
    maxConcurrentRequests?: number;
    retrySchedule?: Schedule.Schedule<unknown, unknown>;
  });

  proveTransaction<S extends Signaturish, B extends Bindingish>(
    transaction: Transaction<S, PreProof, B>,
    costModel?: CostModel,
  ): Promise<Transaction<S, Proof, B>>;
}
```

`maxConcurrentRequests` is the most requests the client has waiting at the Proof Server at once. Unless set it is 10,
the places a Proof Server has in its queue as released. A ledger asks for every proof of a transaction at once, and a
Proof Server refuses the requests its queue has no room for; requests past this number are held back and sent as earlier
ones are answered. It has to be a whole number of at least one: anything else is refused when the client is created,
with an `InvalidMaxConcurrentRequestsError`.

A request the Proof Server has not answered within 10 minutes is given up, which fails the proof and frees its place
among the requests in flight. It is not sent again: a request still waiting after that long may be a proof still being
made.

Interrupting a proof does not withdraw the requests it has already asked the client for: each is still sent in its turn,
ahead of anything the client is asked to prove afterwards.

`retrySchedule` is how often, and how far apart, a request is sent again after the Proof Server could not take it: its
queue was full (HTTP 429), or something between the client and it gave way (HTTP 502, 503, 504). Unless set, the client
waits 1 second, doubling up to 10 seconds, for 5 minutes in all, and then fails the request with what the server said
last. This is what carries a transaction through a Proof Server that other clients, or other transactions of the same
wallet, are also using.

### Proving providers, per ledger version

A proof preimage is produced by the ledger version that built the transaction, and the request carrying it has to be
framed and read back by that same version. `HttpProverClient` therefore offers one provider per ledger version:

```typescript
const client = await Effect.runPromise(HttpProverClient.create({ url: proofServerUrl }));

client.asV9ProvingProvider(); // frames with @midnightntwrk/ledger-v9; asProvingProvider() is the same provider
client.asV8ProvingProvider(); // frames with @midnightntwrk/ledger-v8
```

`WasmProver` offers both names too, and returns the same provider for each: the in-process prover drives a zkir runtime
over bytes and never looks at a ledger version. Its key material, though, is per ledger version: each ledger version's
circuits were generated as their own generation, and a node rejects a proof made with another's. Create the prover with
the key material of the ledger version it proves for:

```typescript
WasmProver.makeV9KeyMaterialProvider(); // ledger-v9: circuit generation 10
WasmProver.makeV8KeyMaterialProvider(); // ledger-v8: circuit generation 9
WasmProver.makeDefaultKeyMaterialProvider(); // the same as makeV9KeyMaterialProvider()
```

Each reads from `https://srs.midnight.network/`, the host the ledger's own data provider reads, and checks every file
against the SHA-256 its ledger release declares before handing it back; a file that does not match is refused with
`KeyMaterialIntegrityError`. To serve the files yourself — a mirror, or your page's own origin, since that host sends no
CORS headers — pass `{ source }`; the files are checked all the same:

```typescript
WasmProver.makeV9KeyMaterialProvider({ source: 'https://example.com/midnight-keys/' });
```

Checking needs Web Crypto (`crypto.subtle`): Node 19 or later, or a browser page served from a secure context.

> This package depends on both ledger runtimes, `@midnightntwrk/ledger-v8` and `@midnightntwrk/ledger-v9`. Both are WASM
> modules, so a direct consumer bundling this package ships both.

## Exports

### Default Export

- `HttpProverClient` - HTTP client for the Proof Server

### Effect Submodule (`/effect`)

Effect.ts-based implementation:

```typescript
import { ProverClient, HttpProverClient } from '@midnightntwrk/wallet-sdk-prover-client/effect';
```

## Error Handling

The client may throw the following errors:

- `ClientError` - Issues with the provided transaction or connection problems
- `ServerError` - Internal server errors or connection failures
- `InvalidProtocolSchemeError` - Invalid URL scheme in configuration

## License

Apache-2.0
