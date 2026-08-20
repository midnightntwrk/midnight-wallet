---
'@midnightntwrk/wallet-sdk-shielded': major
---

**`ShieldedWallet(configuration)` now registers a variant either side of the protocol boundary, and follows the chain
across it.** Until this release it registered exactly one, and a wallet could not cross a fork.

The pre-fork variant is registered from the minimum supported version and reads the chain with the ledger version that
produced it; the post-fork variant is registered at `configuration.forkVersion` — required since the previous release —
and takes over from there, with the cross-ledger migration that carries identity and a cursor onto a fresh state. The
boundary is one number in one place: the version at which the runtime hands over is the version at which each variant
stops applying.

**Registering two variants alters nothing an application calls.** The `state` observable and everything it projects,
`waitForSyncedState`, `restore`, `serializeState` and `getAddress` keep their signatures and meaning. The start and
transacting methods do change in this release, but for other reasons and in other notes — see *Wallets are started from
seeds*, *Transact on either side of the protocol boundary* and *asks the chain where it is starting*. What registering
two variants changes is what runs underneath, and three things worth knowing:

- **A wallet with no way to ask the chain starts on the pre-fork variant.** On a chain that has already forked it hands
  over on the first batch it sees, having applied nothing — one migration per start. As released this is the fallback
  rather than the rule: the start-version probe added later in this same release asks the chain first, so a default
  wallet on a chain past the boundary starts on the post-fork variant with no hand-over at all. Without a probe, or
  when the question goes unanswered, the hand-over is what happens. On a chain that has not forked, the wallet stays on
  the pre-fork variant until the chain reports a version the post-fork one owns.
- **A seed is the only key material that can follow the chain the whole way.** Each variant derives its own from it, so
  a wallet built from a seed can synchronize on either side of the boundary; key objects belong to one ledger version's
  runtime and there is nothing to convert. The single-key `startWithSecretKeys` this change would have pinned to the
  post-fork variant is **deleted** later in this same release rather than shipped — what replaces it is
  `startWithKeys({ v8, v9 })`, which requires both sides for exactly this reason.
- **Restoring routes on the snapshot's declared protocol version**, into whichever of the two variants wrote it. The
  serialized format is unchanged, and snapshots written by this release round-trip: a wallet that has synced past the
  boundary declares a version the post-fork variant owns, and one that has not was written by the pre-fork variant in
  the first place. The exception is a snapshot from an **earlier beta**, where every wallet was the post-fork variant:
  if it declares a version below `forkVersion` — which in practice means a wallet serialized before it had synced
  anything, declaring `0` — it now routes to the pre-fork variant and fails to deserialize. Start such a wallet from
  its seed instead; it has no state to lose.

**A seam that existed between this change and the next, and does not survive into this release.** Registering a
pre-fork variant arrived before there was any way to prove what it built, so for as long as that was true, building a
transaction on the pre-fork variant was refused by name (`balanceTransaction`, `transferTransaction`, `initSwap`).
Version-routed proving and pre-fork transacting close it in this same release — see *Transact on either side of the
protocol boundary* — and `PreForkTransactingUnsupportedError` is not part of the published surface. No version of this
package that an application can install refuses to transact pre-fork. Synchronization, the state observable and
everything it projects, balances, coins, addresses, serialization, restoring and the migration itself worked on
**both** sides of the boundary throughout.

**New entry points.** `CustomForkingShieldedWallet(configuration, preFork, postFork)` builds the same shape over
variants of your choosing, each with **its own configuration** — two variants either side of a boundary can mean
different, mutually unassignable things by the same key. `ForkingShieldedWalletClass`, `ForkingShieldedWallet`,
`ForkingShieldedConfiguration`, `PreForkShieldedVariant`, `PostForkShieldedVariant` and `ForkingShieldedVariants` name
the pieces. `ShieldedWallet` and `ShieldedWalletClass` are now aliases of the forking forms.

**`CustomShieldedWallet(configuration, builder)` is unchanged** — a single variant, and therefore one ledger version:
the composition for a wallet not expected to meet a protocol boundary. `CustomizedShieldedWallet` and
`CustomizedShieldedWalletClass` remain its single-variant types.
