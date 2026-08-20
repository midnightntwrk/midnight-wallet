---
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-dust-wallet': major
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
---

Transact on either side of the protocol boundary. The three wallets' `PreFork*TransactingUnsupportedError` seams —
each documented as temporary, and each refusing every transaction-building call while the wallet was still on the
pre-fork variant — are **closed**. The pre-fork variant builds with the ledger version the chain is actually on, using
its own key material, and what it produces says which version built it.

BREAKING CHANGE — **the `secretKeys` parameters are gone** from every transacting method. A wallet spanning a protocol
boundary derives what its current variant needs from what it was started with; a caller-supplied key object can only
ever belong to one ledger version, which is exactly why it made pre-fork building impossible:

```ts
// before
await shielded.transferTransaction(secretKeys, outputs);
await dust.balanceTransactions(dustSecretKey, [tx], ttl);
await dust.estimateFee(dustSecretKey, [tx], ttl);
// after
await shielded.transferTransaction(outputs);
await dust.balanceTransactions([tx], ttl);
await dust.estimateFee([tx], ttl);
```

BREAKING CHANGE — **transactions cross these APIs as `WalletTransaction` handles** (`UnprovenTx`, `UnboundTx`,
`FinalizedTx`, `AnyTx`) rather than as one ledger version's classes. A handle carries the protocol version it was built
at as ordinary readable data, which is what the SDK routes on: which prover proves it, which validator checks it, which
variant may unwrap it at all. A transaction built on the other side of the boundary is refused by name with a
`ProtocolVersionMismatchError` rather than handed to a ledger version that would misread it — except by
`revertTransaction`, which has nothing of it to release and says so by doing nothing.

An application that builds its own transactions imports `@midnightntwrk/wallet-sdk/ledger/v8` or `/v9` and seals the
result with `WalletTransaction.adopt(stage, tx, version)`.

Signatures and verifying keys are stated in the current ledger version's `{ tag, value }` shape throughout, including
pre-fork: the wallet lowers them for the previous ledger version, which has one signature scheme and writes bare hex.
A signature naming a scheme that version does not have is refused with a typed `UnsupportedSignatureKindError` rather
than lowered into bytes it would misread.

Dust's `balanceTransactions` now returns the block it priced the fee against in the terms both ledger versions report
identically — hash, height, protocol version and parameters — rather than the variant's own `BlockData`, whose dust
index and root fields were never a caller's business.
