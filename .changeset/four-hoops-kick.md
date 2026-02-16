---
'@midnight-ntwrk/wallet-sdk-shielded': major
'@midnight-ntwrk/wallet-sdk-dust-wallet': major
'@midnight-ntwrk/wallet-sdk-facade': major
'@midnight-ntwrk/wallet-sdk-capabilities': patch
---

- Extract proving into a standalone `ProvingService` in the `@midnight-ntwrk/wallet-sdk-capabilities` package, decoupling
  it from the shielded and dust wallet builders. The new service supports server (HTTP prover), WASM, and simulator
  proving modes via a unified configuration.
- Remove `withProving` / `withProvingDefaults` and the `provingService` dependency from the V1 builders in both the
  shielded and dust wallet packages. Proving is no longer a wallet-level concern.
- Integrate the `ProvingService` into `WalletFacade`, which now owns transaction proving and finalization. On proving
  failure the facade reverts the transaction across all three wallet types (shielded, unshielded, dust).

### Breaking changes

- **`@midnight-ntwrk/wallet-sdk-shielded`**: Removed `finalizeTransaction` from `ShieldedWalletAPI`. Removed
  `Proving` export from `@midnight-ntwrk/wallet-sdk-shielded/v1`. Removed `provingService` from the V1 builder
  and `RunningV1Variant.Context`. Removed `withProving` / `withProvingDefaults` from `V1Builder`.
  `DefaultV1Configuration` no longer includes `DefaultProvingConfiguration`.
- **`@midnight-ntwrk/wallet-sdk-dust-wallet`**: Removed `proveTransaction` from `DustWalletAPI`. Removed
  `provingService` from the V1 builder and `RunningV1Variant.Context`. Removed `withProving` /
  `withProvingDefaults` from `V1Builder`.
- **`@midnight-ntwrk/wallet-sdk-facade`**: Removed the `UnboundTransaction` type export (now re-exported from
  `@midnight-ntwrk/wallet-sdk-capabilities/proving`). `WalletFacade` now requires a `ProvingService` and
  `DefaultConfiguration` includes `DefaultProvingConfiguration`.
