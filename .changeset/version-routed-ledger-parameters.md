---
'@midnightntwrk/wallet-sdk-indexer-client': minor
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-dust-wallet': major
---

Read a block's ledger parameters at the protocol version the block reports, instead of at whichever ledger version the
reading code happened to import.

The indexer serves `block { ledgerParameters }` as hex, and that hex is one ledger version's serialization. Three
places turned it into an object by naming a ledger version statically: the validation service's block fetch and each
dust twin's. Either side of a fork that is a guess, and because the two ledger versions cannot read each other's
bytes, a wrong guess lost the whole block behind an untyped WASM throw.

Each now selects its decoder from `LedgerParametersCodec` — a registry keyed by protocol version, built on the same
`ProtocolVersion.Registry` primitive that variant selection uses, so the two cannot disagree about where a version
boundary lies. A version no registered codec claims is an `UnsupportedProtocolVersionError` naming that version; bytes
that reach a codec and fail it are a `LedgerParametersDecodeError`. Both are typed failures a caller can match on.

The `BlockHash` query and the block a dust nullifier transaction names now select `protocolVersion`; the field has
always been on `Block` in the indexer schema.

**What you must change**

- `BlockData` (validation's and dust's) gains a required `protocolVersion: number`. Anything that constructs one by
  hand — test fixtures, simulator harnesses, hand-rolled block-data fetchers — must say which version produced the
  block. Values read from the indexer or from a simulator carry it already.
- Dust's `WireBlockDataSchema` carries `ledgerParameters` as hex rather than as a decoded object: the field saying
  which ledger to use has to be read before the parameters are decoded, the same reason the shielded event payload
  keeps its `raw`. `BlockDataSchema` is now the default-codec instance of `makeBlockDataSchema(codecs)`; pass your own
  registry to bound a variant to the range it is active over.
- `makeDefaultBlockDataFetcher` and dust's `makeDefaultSyncService` accept an optional `ledgerParametersCodecs`. Dust's
  defaults to claiming every protocol version, so a single-variant wallet is unaffected. The block-data fetcher's
  configuration also gains a **required** `forkVersion` by the end of this release, and its default registry is split at
  it rather than claiming everything: `defaultLedgerParametersCodecs` becomes a function of the fork version (see
  *Validate a transaction at the version it was authored for, on a chain with a protocol boundary*).
