---
'@midnightntwrk/wallet-sdk-dust-wallet': major
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-abstractions': major
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-testkit': major
'@midnightntwrk/wallet-sdk': major
'@midnightntwrk/wallet-sdk-utilities': minor
'@midnightntwrk/wallet-sdk-facade': patch
---

fix(dust,shielded,unshielded)!: name no ledger version in the wallet APIs, and configure dust rates as plain numbers

The shielded, dust and unshielded wallet APIs speak only SDK-owned types, exported per wallet as `ShieldedWalletTypes`,
`DustWalletTypes` and `UnshieldedWalletTypes`; each `/v1` and `/v2` subpath still exports the same names. A wallet
state's core state is sealed, readable only through its variant's `coreStateOf`.

Dust rates are plain `DustGenerationRates`, and each variant gets its own ledger version's parameters made from them
(`dustVariantConfigurations`). This fixes `expected instance of DustParameters` after `forks.v9` when plain rates were
configured; either ledger version's `DustParameters` is still accepted. A fresh start that names no rates now uses the
configured ones rather than the ledger's initial ones, in `DustWallet`, `CustomForkingDustWallet` (new
`ForkingDustConfiguration.dustParameters`) and `CustomDustWallet`.

Also:

- abstractions adds `VariantState` and `UnshieldedUtxo`, and `WalletTransaction.unwrapWithin` refuses a handle sealed
  by another copy of the package with a `ForeignTransactionHandleError` instead of throwing.
- capabilities adds `withLedgerParameters`, which types block data whose parameters arrive as `unknown`.
- `UnshieldedWalletState.verifyingKey` reports the key in the SDK's signature shape on both sides of `forks.v9`.
- The unshielded root's `PublicKey`, `UnshieldedKeystore` and `UnshieldedSecretKey` are stated in the SDK's signature
  shapes, also as `UnshieldedWalletTypes.*`. The ledger-v9 keystore moved into `/v2`, beside `/v1`'s ledger-v8 one, and
  the root's `createKeystore` derives its keys there.
- utilities adds `eitherCoreStateOf` on `/testing/variants`, and the testkit's `DustWalletFactory` takes plain rates.
- utilities' `HttpURL.make` and `WsURL.make` refuse a URL with the wrong scheme with a message that names it, such as
  `Invalid protocol scheme 'ftp:'. Expected 'http:' or 'https:'`, rather than `[object Object]`.

BREAKING CHANGE:

- `ShieldedWalletState.state`, `DustWalletState.state` and `UnshieldedWalletState.state` are a sealed `VariantState`;
  read it with `coreStateOf` from `/v1` or `/v2`. The state constructors take a `progress` projection, and
  `UnshieldedWalletState`'s a `verifyingKey` one.
- Removed: `ShieldedWalletCapabilities`, `ShieldedWalletServices`, `DustWalletCapabilities`, `DustWalletServices`,
  `ShieldedCoreState`, `DustCoreState`, `UnshieldedCoreState`, and the shielded `V9UnboundTransaction` re-export (still
  exported by `@midnightntwrk/wallet-sdk-capabilities/proving`).
- `ShieldedWalletAPI` and `ShieldedWalletState` drop their unused transaction type parameter.
- `DustWalletAPI.balanceTransactions` returns `blockData` with `unknown` parameters; `withLedgerParameters` types them.
- `DefaultDustConfiguration.dustParameters` reads as `DustGenerationRates`, and `CustomDustWallet` defaults its
  configuration to `/v2`'s `DefaultV2Configuration`.
- The dust root, and so the umbrella package, no longer re-exports the V2 sync module: use `SyncService` from `/v2`
  (`makeEventLessSyncService`, `makeEventLessSyncCapability`, `findDustTimelineStart`). `DustTimelineStart` is
  `DustWalletTypes.DustTimelineStart`.
- The ledger-v9 simulator is no longer exported unqualified from the capabilities root or `/simulation`: use
  `V9.Simulator` (`Capabilities.V9.Simulator` in the umbrella package). A wallet's `/v2` `Simulator` is that simulator
  alone.
- `WalletTransaction.unwrapWithin` returns `Either<T, WalletTransactionUnwrapError>`.
- Removed deprecated aliases: the shielded `V9_NATIVE_FORK_VERSION` (use `ProtocolVersion.V9NativeForkVersion`), the
  simulators' `getBlockEventsSince` (use `getBlockEventsFrom`), and the testkit's `dustSnapshotPath`; saving a snapshot
  no longer deletes files earlier snapshot layouts left behind.
