---
'@midnightntwrk/wallet-sdk-abstractions': patch
'@midnightntwrk/wallet-sdk-facade': minor
---

Add `WalletFacade.adoptTransaction(bytes, stage)`, for reading a transaction from bytes that name no protocol version.

Bytes that reach a wallet from outside the SDK carry no version stamp — the DApp Connector API passes a serialized
transaction and nothing else — so, until now, every wallet exposing a connector had to write the same routing by hand:
read `activeProtocolVersion` off the facade's state, compare it to `forks.v9`, pick `wallet-sdk/ledger/v8` or `/v9`,
map the handle's stage to the ledger's signature/proof/binding marker triple, deserialize, and seal the result with
`WalletTransaction.adopt`. The stage-to-markers mapping in particular existed nowhere in the SDK, leaving each
implementation to re-derive it.

`adoptTransaction` does that routing with the facade's own current protocol version, and returns the sealed handle:

```ts
// before
const version = (await firstValueFrom(facade.state())).activeProtocolVersion;
const markers = { Unproven: [...], Unbound: [...], Finalized: [...] }[stage];
const transaction =
  version < configuration.forks.v9 ? v8.Transaction.deserialize(...markers, bytes) : v9.Transaction.deserialize(...markers, bytes);
const handle = WalletTransaction.adopt(stage, transaction, version);

// after
const handle = facade.adoptTransaction(bytes, stage);
```

Bytes written by the other ledger version — a dApp that authored on the other side of a protocol boundary — are
refused with a `WireFormatError` naming the protocol version the wallet is acting at, rather than the ledger's raw
serialization-tag mismatch. The policy above it stays with the wallet: whether to accept dApp bytes at all, whether to
refuse while the wallets are still crossing, and how to map the refusal onto the connector's own error codes.
