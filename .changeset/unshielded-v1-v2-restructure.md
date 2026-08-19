---
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
'@midnightntwrk/wallet-sdk': minor
'@midnightntwrk/wallet-sdk-facade': patch
---

Restructure the unshielded wallet for the coming hard fork: the variant directories now say which ledger they run on.

**The `./v1` subpath's contents change on this beta line.** What `@midnightntwrk/wallet-sdk-unshielded-wallet/v1`
exported in `4.0.0-beta.2` — the ledger-v9 production variant — now lives at `./v2`, with every `V1`-named export
renamed to `V2` (`V1Builder`→`V2Builder`, `V1Tag`→`V2Tag`, `DefaultV1Configuration`→`DefaultV2Configuration`,
`RunningV1Variant`→`RunningV2Variant`, `makeDefaultV1SerializationCapability`→`makeDefaultV2SerializationCapability`,
and so on). Imports of the old names from `./v1` will no longer resolve — switch the subpath to `./v2`.

`./v1` now holds the restored pre-fork ledger-v8 variant with its honest `V1` names, kept for wallets that must sync
pre-fork history across the fork. This makes `@midnight-ntwrk/ledger-v8` a runtime dependency of the package: consumers
of the `./v1` subpath load a second ledger WASM module, which matters for browser bundle size. The `Simulator` namespace
exported from `./v1` is the ledger-v8 simulator twin only, where it previously re-exported the whole simulation entry
point.

**The restored variant speaks the current signing architecture.** This is where the unshielded restructure differs from
shielded's and dust's. The pre-fork code predates the async-signer refactor, and the shared wallet layer now requires
the `SigningService`/`SignSegment` split of every variant — so `./v1` adopts it rather than shipping the synchronous
signing it originally had. Concretely, on `./v1`:

- `Signing.ts` is new, exporting `SignSegment` (`(data) => Promise<Signature>`) and `SigningService`, alongside
  `makeDefaultSigningService`.
- `TransactingCapability` no longer has `signUnprovenTransaction` or `signUnboundTransaction`. Signing goes through the
  service, and `RunningV1Variant`'s two signing entry points now take an async `SignSegment` where they took a
  synchronous `(data) => Signature`.
- `TransactionOps` gains `collectSignableData` and `attachSignatures` (with `SignableSegment` and `SegmentSignature`),
  the pure halves the service delegates to.
- `V1Builder` gains `withSigning` and `withSigningDefaults`; `withDefaults()` includes signing, but a builder configured
  capability-by-capability now has to supply it.

What does **not** come across is everything genuinely ledger-v9: ECDSA support and the scheme-consistency checks. This
ledger version has a single signature scheme, so `./v1` has no `SchemeMismatchError` and does not validate a
signature's scheme before attaching it.

The one scheme-consistency check that **is** expressible without schemes does come across, and it is a behavioural
change against the 1.x line: `./v1` deserialization now asserts that a snapshot's address really derives from its
verifying key (`assertKeyAddressConsistency`, exported from `./v1`'s `Serialization`). A snapshot with a spliced or
mismatched key/address pair — which previously restored silently — now fails with an `OtherWalletError`, as does one
whose verifying key cannot be decoded at all, where the ledger's wasm decoder previously threw out of `deserialize`.
Snapshots written by any released wallet are unaffected. Relatedly, `./v1`'s `TransactionOps.extractOwnInputs` now
returns UTxOs owned by the derived address rather than by the verifying key, matching `./v2` and every other `Utxo` the
wallet holds.

**`./v1` carries its own keystore.** `createKeystore`, `PublicKey` and `UnshieldedKeystore` are exported from the `./v1`
subpath as ledger-v8 types, because the two ledger versions disagree about what a key is: v8 signing and verifying keys
are bare hex strings, v9's are `{tag, value}` records naming a scheme. So `createKeystore` on `./v1` takes a
`Uint8Array` secret, while the package root's takes `{kind, secret}`. The root entry point continues to export the
ledger-v9 keystore, unchanged. Both keystores gained `signDataAsync`, so an in-process keystore can be passed straight
to the async signer.

`@midnightntwrk/wallet-sdk` mirrors all of this: `unshielded/v1` now re-exports the ledger-v8 variant, and a new
`unshielded/v2` subpath re-exports the ledger-v9 one.

Nothing changes at the root entry points: `UnshieldedWallet`, `UnshieldedWalletAPI` and friends keep their names, the
production wallet still registers only the ledger-v9 variant, and serialized wallet states round-trip unchanged —
snapshots never embedded the variant naming. The facade update is an internal repoint to the renamed types.
