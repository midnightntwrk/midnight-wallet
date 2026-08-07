# @midnightntwrk/wallet-sdk-testkit

Reusable wallet-SDK test harness, extracted from `packages/e2e-tests`. Provides environment provisioning, wallet
bootstrapping, sync waiters, and tx-history assertions as a published package so downstream consumers (e.g. monitoring /
healthcheck suites) can write their own test scenarios against the same harness instead of vendoring copies of these
files.

## What's here

| Area                 | Exports                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| Environment          | `createRemoteEnvironment`, `NETWORK_PRESETS`, `makeEnvironment`, `WalletTestEnvironment`, `ResolvedEndpoints` |
| Environment (Docker) | `createTestContainersEnvironment` — from `@midnightntwrk/wallet-sdk-testkit/testcontainers`                   |
| Wallet               | `provideWallet`, `initWalletWithSeed`, `saveState`, `WalletInit`                                              |
| Seeds                | `getShieldedSeed`, `getUnshieldedSeed`, `getDustSeed`                                                         |
| Sync waiters         | `waitForSyncUnshielded`, `waitForDustBalance`, `waitForTxInHistory`, …                                        |
| Assertions           | `expectSenderShieldedTxHistory`, `expectReceiverUnshieldedTxHistory`, …                                       |
| Addresses            | `validateNetworkInAddress`, `getShieldedAddress`, `getUnshieldedAddress`                                      |
| Vitest glue          | `useWalletTestEnvironment`, `installRetryLogging`                                                             |
| Logging              | `logger`, `setLogger`, `getLogger`                                                                            |

## Key change from `e2e-tests`

The old `TestContainersFixture` resolved endpoints from `process.env` (`NETWORK`, `PROOF_SERVER_URL`, `SYNC_CACHE`) and
mapped container ports. That coupling is gone: a `WalletTestEnvironment` now carries fully-resolved `endpoints`,
produced either by `createTestContainersEnvironment` (Docker) or `createRemoteEnvironment` (no Docker, point at an
already-running network). Downstream consumers no longer need to patch this file to inject a proof-server URL.

## Usage — remote network, no Docker

```ts
import { afterAll } from 'vitest';
import {
  createRemoteEnvironment,
  useWalletTestEnvironment,
  provideWallet,
  waitForDustBalance,
} from '@midnightntwrk/wallet-sdk-testkit';

const getEnv = useWalletTestEnvironment(() =>
  createRemoteEnvironment({
    network: 'devnet',
    proverUrl: process.env.PROOF_SERVER_URL!, // a running proof server you control
  }),
);

test('wallet reaches a dust balance', async () => {
  const env = getEnv();
  const { wallet } = await provideWallet(env, { seed: MY_SEED });
  afterAll(() => wallet.stop());
  await waitForDustBalance(wallet);
});
```

## Usage — local stack via testcontainers

```ts
import { useWalletTestEnvironment } from '@midnightntwrk/wallet-sdk-testkit';
import { createTestContainersEnvironment } from '@midnightntwrk/wallet-sdk-testkit/testcontainers';

const getEnv = useWalletTestEnvironment(() => createTestContainersEnvironment({ network: 'undeployed' }));
```

## Choosing the Dust sync model

Dust can sync from the indexer's event stream or from its projections (the "event-less" fast sync). `DUST_SYNC` selects
which, for a whole run:

```bash
DUST_SYNC=projections yarn test-remote -- -t @healthcheck
```

Unset, `provideWallet` and `initWalletWithSeed` build the event-based sync; the dust and token-transfer healthcheck
scenarios fall back to projections instead, so the network being monitored is exercised against the model the wallet
ships to users. `DUST_SYNC` overrides both, so a run can never end up half on one model and half on the other. An
unrecognized value is rejected rather than defaulted, so a typo cannot report a run as covering a model it did not
exercise.

A test that needs a specific model regardless of the environment pins it in code, which does override `DUST_SYNC`:

```ts
provideWallet(env, { ...projectionsDustSyncOptions, seed, syncCacheDir, filename });
```

Use `manualProjectionsDustSyncOptions` instead when the test drives each sync pass itself with `facade.doSync()`; the
plain `projectionsDustSyncOptions` leaves background synchronization on, so the usual state waiters work unchanged.

Pin a model only when the test genuinely requires it. A pinned wallet stops following `DUST_SYNC`, so a lane switched by
environment will leave it behind — which reports coverage the run did not have.

### Building a Dust wallet directly

A test that constructs its own Dust wallet rather than going through the helpers must build it from the same source, or
it will silently disagree with the rest of the run:

```ts
const Dust = dustWalletFromEnv()({ ...walletConfig, ...env.getDustWalletConfig() });
```

This matters most for serialize/restore tests. The two models disagree about the meaning of the single progress value a
Dust snapshot carries — an event cursor to one, a composite of tree indices and nullifier count to the other — so state
written by one model and restored into the other resumes from a position that is not a cursor at all, and the wallet
never reports synced. Hard-coding `DustWallet(...)` as the restore target while the run uses projections does exactly
that.

Snapshots on disk are protected from this automatically: they are stored per model, so switching models finds no
snapshot and rebuilds from scratch rather than resuming wrongly, with no cache to clear by hand. That protection does
not extend to state serialized and restored in memory within a test — hence the rule above. The shielded and unshielded
snapshots are model-independent and shared.

## Peer dependencies

- `vitest` — required (assertions and the environment hooks use it).
- `testcontainers` and `@midnightntwrk/wallet-sdk-utilities` — optional; only needed for the `/testcontainers` entry
  point.
