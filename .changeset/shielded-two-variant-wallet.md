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

**Nothing an application calls changes shape.** `startWithSeed`, `restore`, `start(keys)`, the `state` observable and
everything it projects, `waitForSyncedState`, `serializeState` and `getAddress` keep their signatures and meaning, and
existing calls compile unchanged. What changes is what runs underneath, and three things worth knowing:

- **A wallet starts on the pre-fork variant.** On a chain that has already forked it hands over on the first batch it
  sees, having applied nothing — one migration per start, paid on chains that are entirely past the boundary. It is
  accepted rather than hidden: removing it means asking the chain for its version before choosing a variant, which is
  separate work. On a chain that has not forked, the wallet stays on the pre-fork variant until the chain reports a
  version the post-fork one owns.
- **`startWithSeed` is the only start that can follow the chain the whole way.** The seed is the one piece of key
  material that crosses a boundary — each variant derives its own from it. `start(keys)` keeps working: the keys are
  the post-fork ledger version's, so they are retained against that variant, and a wallet still on the pre-fork variant
  is started from the seed it retained. A wallet built with `startWithSecretKeys` therefore starts **on the post-fork
  variant** and stays there, because key objects belong to one ledger version's runtime and there is nothing to
  convert; it cannot read a chain that is still pre-fork.
- **Restoring routes on the snapshot's declared protocol version**, into whichever of the two variants wrote it. The
  serialized format is unchanged, and snapshots written by this release round-trip: a wallet that has synced past the
  boundary declares a version the post-fork variant owns, and one that has not was written by the pre-fork variant in
  the first place. The exception is a snapshot from an **earlier beta**, where every wallet was the post-fork variant:
  if it declares a version below `forkVersion` — which in practice means a wallet serialized before it had synced
  anything, declaring `0` — it now routes to the pre-fork variant and fails to deserialize. Start such a wallet from
  its seed instead; it has no state to lose.

**Temporary: building a transaction is refused while the wallet is on the pre-fork variant**, with the typed
`PreForkTransactingUnsupportedError` naming the operation (`balanceTransaction`, `transferTransaction`, `initSwap`).
**This seam must not survive to general availability** — mainnet is pre-fork until the fork happens, so a wallet that
cannot transact pre-fork cannot be the wallet that ships. It closes with the version-routed proving increment, which
routes a recipe to the prover that speaks the protocol version it was built at; until then the only proving path this
SDK has speaks the post-fork ledger version, and there is nothing honest for the pre-fork branch to return.
Synchronization, the state observable and everything it projects, balances, coins, addresses, serialization, restoring
and the migration itself all work on **both** sides of the boundary. `revertTransaction` is deliberately not part of the
seam: it builds nothing, needs no proving, and on the pre-fork variant releases nothing, because that variant cannot
have produced the transaction being reverted.

**New entry points.** `CustomForkingShieldedWallet(configuration, preFork, postFork)` builds the same shape over
variants of your choosing, each with **its own configuration** — two variants either side of a boundary can mean
different, mutually unassignable things by the same key. `ForkingShieldedWalletClass`, `ForkingShieldedWallet`,
`ForkingShieldedConfiguration`, `PreForkShieldedVariant`, `PostForkShieldedVariant` and `ForkingShieldedVariants` name
the pieces. `ShieldedWallet` and `ShieldedWalletClass` are now aliases of the forking forms.

**`CustomShieldedWallet(configuration, builder)` is unchanged** — a single variant, and therefore one ledger version:
the composition for a wallet not expected to meet a protocol boundary. `CustomizedShieldedWallet` and
`CustomizedShieldedWalletClass` remain its single-variant types.
