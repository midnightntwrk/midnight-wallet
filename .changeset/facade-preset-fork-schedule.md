---
'@midnightntwrk/wallet-sdk-facade': minor
'@midnightntwrk/wallet-sdk': minor
---

feat(facade): preset the fork schedule, so a configuration need not say where the chain hands over to ledger-v9

`forks` may now be left out of the facade's `DefaultConfiguration`. `WalletFacade.init` then fills in
`DefaultForkSchedule` — `ProtocolVersion.V9NativeForkSchedule`, ledger-v9 from the version a 2.x node reports — and
hands the completed configuration to every factory in `InitParams`, wallets and services alike. A configuration that
does name `forks` is handed exactly what it named.

The wallet packages are unchanged: `ShieldedWallet`, `UnshieldedWallet` and `DustWallet` still require `forks`, because
where a chain forks is a fact about the chain. The facade is the one place a preset decides nothing the SDK had not
already decided — every application was copying the same constant into its configuration — which is why the preset
lives there and nowhere lower.

What a factory is handed is typed `ResolvedConfiguration<TConfig>`: the configuration as given, with `forks` always
present. `shielded: (config) => ShieldedWallet(config)` keeps compiling as before. Code outside a factory that needs the
configuration the facade will use — to build a wallet package directly, or to read `forks` back and author a transaction
for the right ledger version — calls `WalletFacade.resolveConfiguration(configuration)`, which returns that same
`ResolvedConfiguration`. `init` accepts the result as it is, so a configuration can be resolved once and serve both.
