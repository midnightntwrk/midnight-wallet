---
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-dust-wallet': major
'@midnightntwrk/wallet-sdk-facade': major
'@midnightntwrk/wallet-sdk-testkit': major
---

fix(shielded,dust,facade)!: start wallets with keys for every ledger version they run

`facade.start()` reduced its material to ledger-v9 keys, so a shielded or dust wallet restored from a snapshot written
below `forks.v9`, which resumes on its V1 variant, failed with `MissingStartAuxError`. The facade now hands every wallet
one ledger version's keys per side of the boundary — derived from the seeds, or taken from `FacadeKeysByEpoch` — and
each wallet takes the side it runs on. `facade.start()` and `facade.doSync()` take the same material as before.

BREAKING CHANGE: `ShieldedWalletAPI` and `DustWalletAPI` no longer name a key type. `start`, and the dust wallet's
`stepSync`, take the wallet's own keys type — the first type parameter, `never` by default:

| Wallet instance                              | Before                                                              | Now                                       |
| -------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------- |
| `ShieldedWallet(…)`                          | `start(v9Keys)`, `startWithSeed(seed)`, `startWithKeys({ v8, v9 })` | `start({ v8, v9 })`                       |
| `DustWallet(…)`                              | `start(v9Key)`, `startWithSeed(seed)`, `startWithKeys({ v8, v9 })`  | `start({ v8, v9 })`                       |
| `DustWallet(…)`                              | `stepSync(v9Key)`                                                   | `stepSync({ v8, v9 })`                    |
| `CustomShieldedWallet(…)`, `CustomDustWallet(…)` | `start(key)`, `stepSync(key)`                                   | `start({ v9: key })`, `stepSync({ v9: key })` |

A restored wallet is started with `start({ v8, v9 })` whichever side its snapshot was written on; a caller holding a seed
derives both keys with each ledger version's `fromSeed`. The class-level `startWithSeed` and `startWithKeys` are
unchanged. A wallet typed as a bare `ShieldedWalletAPI` or `DustWalletAPI` cannot be started; give its keys type, such as
`ShieldedWalletAPI<ShieldedKeysByEpoch>`. `InitParams.shielded` and `InitParams.dust` now return
`ShieldedWalletAPI<ShieldedKeysByEpoch>` and `DustWalletAPI<DustKeysByEpoch>`, and the testkit's `DustWalletFactory`
returns `DustWalletAPI<DustKeysByEpoch>`.
