---
'@midnightntwrk/wallet-sdk-testkit': minor
---

feat(testkit)!: monitor the projections dust sync by default in the healthcheck scenarios

**Behaviour change for consumers of `registerDustHealthchecks` and
`useTokenTransferWallets`/`registerTokenTransferHealthchecks`.** Both now build their wallets with the projections
("event-less") dust sync instead of the event stream, so the network being monitored is exercised against the sync
model the wallet ships to users.

Background synchronization runs the projections passes, so the scenarios' state waiters behave exactly as they did
before — no consumer has to drive `doSync()`. This depends on the dust wallet repeating a finite sync pass in the
background, so it requires a `@midnightntwrk/wallet-sdk-dust-wallet` new enough to support that.

To keep monitoring the event-stream sync instead, pass the dep explicitly:

```ts
registerDustHealthchecks({ getEnv, seed, walletOptions: { dustWallet: eventBasedDustWallet } });
```

Projections is a **fallback, not a pin**: the scenarios resolve their model through `dustWalletFromEnv`, so `DUST_SYNC`
still overrides it. Without that, setting `DUST_SYNC=events` would switch the wallets built by `provideWallet` and
`initWalletWithSeed` while silently leaving these scenarios on projections — a lane half on each model, reporting
coverage the run did not have.

These scenarios leave background synchronization on. A caller that wants to decide when each pass runs wants
`manualProjectionsDustSyncOptions` instead — but not for these scenarios, which wait on the state stream rather than
driving passes themselves.
