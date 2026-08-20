---
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-testkit': patch
---

`UnshieldedWallet(configuration)` is a two-variant, fork-crossing wallet, and `forkVersion` is required.

The shipped unshielded wallet now registers one variant either side of a protocol boundary — the pre-fork ledger version
from the minimum supported version, the post-fork one from `configuration.forkVersion` — and follows the chain across
it. The crossing itself is unchanged and still proven by `src/test/forkSimulation.test.ts`, which was rewired onto the
shipped factory with **no assertion changed**: the test-only two-variant builder it used to stand on has been dissolved
into `src/test/forkHarness.ts`, which is now observation and simulated infrastructure around the real wallet.

Unshielded's crossing is a **structural carry**, not a fresh state plus replay. Its UTXOs are public ledger data the
wallet holds as plain records, so every one of them crosses field for field, along with the identity, the network and
the parked cursor — and the wallet never passes through a state in which it has forgotten what it owns. The boundary
transaction is applied exactly once, by the new variant: the old one records its version and refuses every part of it,
which leaves the cursor pointing just before it for the new variant to re-fetch from.

**`forkVersion` is required on `DefaultUnshieldedConfiguration`, without a default.** A wrong value does not degrade —
it decides which ledger version reads the chain. `@midnightntwrk/wallet-sdk-shielded` publishes `V9_NATIVE_FORK_VERSION`
(`2000000`, measured on a ledger-v9-native node line) for suites and applications pointed at such a chain; the field is
the same name and type the shielded and dust configurations already required, so an application composing the facade's
configuration passes it once and nothing else changes — `@midnightntwrk/wallet-sdk-facade` needed no source change at
all.

What else moved:

- **`startWithPublicKey` resolves which variant can hold the identity it is given.** A ledger-v9 verifying key is a
  `{tag, value}` record; a ledger-v8 one is bare hex, because that version had exactly one signature scheme. A
  **schnorr** identity therefore narrows losslessly, starts on the pre-fork variant and follows the chain the whole
  way, with the migration widening it back. An **ecdsa** identity starts on the post-fork variant and stays there: that
  scheme did not exist pre-fork, derives a different address, and narrowing it would produce a wallet claiming an
  identity it does not have.
- **Nothing is retained across the boundary, and nothing needs to be.** Unshielded synchronization is watch-only — the
  address is public and signing is supplied per call — so `start()` still takes no argument and a migration strands no
  key material.
- `UnshieldedWalletState` binds its projections to the variant that produced the emission
  (`UnshieldedWalletState.fromVariant` replaces `mapState`). Everything it projects is version-agnostic plain data; the
  version union surfaces on `state` alone. The `capabilities` and `services` members are **gone**, together with the
  `UnshieldedWalletCapabilities` and `UnshieldedWalletServices` types — the one reading they could have exposed that is
  genuinely version-bound, the verifying key, was never projected and still is not.
- `restore` routes on the protocol version the snapshot declares (unshielded snapshots have always persisted it, on
  both variants), falling back to the head variant for an envelope that declares none; a version no registered variant
  owns raises the typed `UnsupportedSnapshotVersionError`, exported as `UnshieldedRestore.UnsupportedSnapshotVersionError`
  so it does not collide with the other wallets' same-named classes in the umbrella barrel.
- `CustomUnshieldedWallet` is unchanged and still single-variant.

**A seam that existed between this change and the next, and does not survive into this release.** Registering a
pre-fork variant arrived before there was any way to prove what it built, so for as long as that was true,
`balanceFinalizedTransaction`, `balanceUnboundTransaction`, `balanceUnprovenTransaction`, `transferTransaction`,
`rotateUtxos`, `initSwap`, `signUnprovenTransaction` and `signUnboundTransaction` were refused by name while the wallet
was on the pre-fork variant. Version-routed proving and pre-fork transacting close it in this same release — see
*Transact on either side of the protocol boundary* — and `PreForkUnshieldedTransactingUnsupportedError` is not part of
the published surface. Everything else worked on both sides throughout: synchronization, the state observable and all
its projections, balances, coins, the address, `revertTransaction`, serialization, restore, and the migration.
`revertTransaction` was deliberately outside the seam — the pre-fork variant cannot have built the transaction being
reverted so it has booked nothing to release, and the facade reverts all three wallets together when a submission
fails.

**One consequence, since removed.** A wallet with no way to ask the chain where it is pays one spurious migration on a
chain already past the boundary: it begins on the pre-fork variant, applies nothing, and hands over on the first message
it sees. For unshielded that carries nothing across and leaves the cursor at the start, so the post-fork variant simply
syncs the chain itself. The start-version probe added later in this same release removes that for a default wallet, and
leaves it as the fallback for a wallet whose question goes unanswered.

BREAKING CHANGE — `DefaultUnshieldedConfiguration` requires `forkVersion`. `UnshieldedWalletState.capabilities` and
`UnshieldedWalletState.services` are removed, along with the `UnshieldedWalletCapabilities` and
`UnshieldedWalletServices` types and the `UnshieldedWalletState.mapState` constructor (use
`UnshieldedWalletState.fromVariant`); read through the state's own projections instead. `UnshieldedWalletState.state`
is a union of the two variants' core states. The `UnshieldedWallet` and `UnshieldedWalletClass` types now describe a
two-variant wallet and are declared by `ForkingUnshieldedWallet.ts`. The testkit's environments supply `forkVersion` to
the unshielded wallet they build.
