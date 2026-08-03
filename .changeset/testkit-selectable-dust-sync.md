---
'@midnightntwrk/wallet-sdk-testkit': minor
---

feat(testkit): sync dust from projections by default in the healthcheck scenarios

**Behaviour change for consumers of `registerDustHealthchecks` and `useTokenTransferWallets`/
`registerTokenTransferHealthchecks`.** Both now build their wallets with the projections-based (event-less) dust sync
instead of the event stream, so the networks they monitor are exercised against it. Background syncing stays enabled,
so no consumer has to drive `doSync()`.

To keep the previous behaviour, pass the new `walletOptions` dep explicitly:

```ts
registerDustHealthchecks({ getEnv, seed, walletOptions: { dustWallet: eventBasedDustWallet } });
```

Supporting API, all additive:

- `eventLessDustWallet`, `eventBasedDustWallet` and the `DustWalletFactory` type are exported from the root and
  `/core` entry points.
- `provideWallet` and `initWalletWithSeed` accept an optional `dustWallet` factory and a `manualSync` flag. These
  still default to the event-based wallet with background syncing, so direct callers are unaffected — only the
  scenarios' default changed.
- The `dustWallet` factory applies to the restored and the built-from-scratch paths alike, so a cold state cache
  cannot silently fall back to a different sync model than the caller asked for.
