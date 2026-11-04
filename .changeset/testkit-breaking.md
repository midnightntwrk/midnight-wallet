---
'@midnightntwrk/wallet-sdk-testkit': major
---

Breaking changes since 0.2

- Wallets are built for a chain that runs ledger-v8 below `forks.v9` and ledger-v9 from it: the package depends on
  `@midnightntwrk/ledger-v9` `1.0.0-rc.7` instead of `@midnight-ntwrk/ledger-v8`, environments set `forks` to
  `V9NativeForkSchedule`, and `WalletInit` gains `seeds` and `dustSyncModel`. The key objects in `WalletInit`, and the
  transaction `waitForStateAfterDustRegistration` takes, are ledger-v9's.
- `saveState(walletInit, dir, name)` takes what `provideWallet` or `initWalletWithSeed` returned, not the facade. It
  writes the shielded and Dust states to one file per Dust sync model (`snapshotPath`), under a temporary name renamed
  over the previous snapshot, so a save that fails part-way leaves the previous one intact, and it rejects when a state
  cannot be serialized or written instead of logging. The unshielded state, which a restore never read, is no longer
  saved. Snapshots in the 0.2 layout are ignored, so a carried cache rebuilds from scratch once.
- The Dust and token-transfer scenarios build their wallets on the projections Dust sync; pass
  `{ dustWallet: eventBasedDustWallet }` in their `walletOptions` to keep the event stream. They save a snapshot only
  after their tests pass, and time out after 15 minutes instead of an hour.
