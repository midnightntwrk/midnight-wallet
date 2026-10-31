---
'@midnightntwrk/wallet-sdk-dust-wallet': major
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-abstractions': minor
'@midnightntwrk/wallet-sdk-capabilities': minor
'@midnightntwrk/wallet-sdk-facade': patch
'@midnightntwrk/wallet-sdk-testkit': patch
---

fix(dust,shielded,unshielded)!: name no ledger version in the wallet APIs, and configure dust rates as plain numbers

The shielded, dust and unshielded wallet APIs no longer name a ledger version. The data they speak — coins, nullifiers,
commitments, dust, UTxOs, transfers, signatures, sync settings and history storage — is declared in types the SDK owns,
which both variants are stated in; each `/v1` and `/v2` subpath still exports the same names. A wallet state's core
state is sealed, readable only by the variant that produced it, and everything an application reads is projected beside
it as before.

`DefaultDustConfiguration.dustParameters` now takes the plain `DustGenerationRates` the changelog already promised. It
was typed as ledger-v9's `DustParameters` class, and a plain object passed anyway failed with
`expected instance of DustParameters` once the wallet crossed `forks.v9`. `DustWallet` now gives each variant its own
ledger version's parameters made from the rates. Either ledger version's `DustParameters` is still accepted.

A fresh start that names no rates now values its empty state against the configured ones, on whichever variant it
begins. It used the ledger's initial rates instead, so a wallet started past `forks.v9` kept them for good and one
started below it until it crossed. `ForkingDustConfiguration` gains the optional `dustParameters` a
`CustomForkingDustWallet` start falls back to, which `DustWallet` fills from its configuration, and a single-variant
`CustomDustWallet` start falls back to its configuration's `dustParameters` the same way. Rates passed to a start still
win.

Also:

- Each wallet package exports those types under its own name — `ShieldedWalletTypes`, `DustWalletTypes`,
  `UnshieldedWalletTypes` — together with the capability contracts both of its variants implement, so an application names `ShieldedWalletTypes.AvailableCoin` or `UnshieldedWalletTypes.TokenTransfer`
  without reaching into `/v1` or `/v2`. Namespaced because two wallets can declare the same name, and the umbrella
  package re-exports every wallet into one barrel.
- `@midnightntwrk/wallet-sdk-abstractions` adds `VariantState`, a variant's core state sealed under its tag, and
  `UnshieldedUtxo`, the UTxO shape the unshielded and dust wallets share.
- `@midnightntwrk/wallet-sdk-capabilities/validation` adds `withLedgerParameters`, which types block data whose
  parameters arrived as `unknown` by asking which ledger version's object they are.
- `UnshieldedWalletState.verifyingKey` reports the wallet's key in the SDK's signature shape on either side of the
  boundary, ledger-v8's bare key lifted into it.
- The testkit's `DustWalletFactory` starts a wallet against plain `DustGenerationRates`.

BREAKING CHANGE:

- `ShieldedWalletState.state`, `DustWalletState.state` and `UnshieldedWalletState.state` are a sealed `VariantState`.
  Read a variant's core state with `coreStateOf` from that package's `/v1` or `/v2` subpath, which returns it when that
  variant produced the state and nothing otherwise. `progress` is read from the wallet state itself, as before.
- The wallet state constructors take a `progress` projection, and `UnshieldedWalletState`'s a `verifyingKey` one.
- Removed: `ShieldedWalletCapabilities`, `ShieldedWalletServices`, `DustWalletCapabilities`, `DustWalletServices`,
  `ShieldedCoreState`, `DustCoreState`, `UnshieldedCoreState`, and the shielded package's `V9UnboundTransaction`
  re-export, which `@midnightntwrk/wallet-sdk-capabilities/proving` still exports.
- `ShieldedWalletAPI<TKeys, TTransaction, TSerialized>` is now `ShieldedWalletAPI<TKeys, TSerialized>`, and
  `ShieldedWalletState<TSerialized, TTransaction>` is now `ShieldedWalletState<TSerialized>`. The transaction parameter
  was never used.
- `DustWalletAPI.balanceTransactions` returns `blockData` whose `ledgerParameters` is `unknown`: they are the pricing
  variant's own ledger object. `withLedgerParameters` types them again.
- Reading `DefaultDustConfiguration.dustParameters` gives `DustGenerationRates`, not a ledger object. A composition
  that hands the configuration to a variant builder passes it `asV8DustParameters(rates)` or
  `asV9DustParameters(rates)`, as `DustWallet` does.
- `CustomDustWallet` and `CustomizedDustWalletClass` default their configuration to the V2 variant's
  `DefaultV2Configuration` (from `/v2`) instead of `DefaultDustConfiguration`, as the unshielded wallet's already do.
- The dust package root no longer re-exports the V2 variant's sync module or its `BlockData`, which named ledger-v9 and
  claimed generic names such as `IndexerClientConnection` and `DefaultSyncConfiguration` in the umbrella package. They
  stay on `/v2`: the eventless fast sync is `SyncService.makeEventLessSyncService` and
  `SyncService.makeEventLessSyncCapability` from there, and the dust timeline search
  `SyncService.findDustTimelineStart`. Its answer, `DustTimelineStart`, is `DustWalletTypes.DustTimelineStart`.
- `Simulator` from each wallet's `/v2` subpath is the ledger-v9 simulator alone, as `/v1`'s is the ledger-v8 one. It no
  longer carries `V8`, `ForkSimulator` and the rest of the capabilities simulation entry.
