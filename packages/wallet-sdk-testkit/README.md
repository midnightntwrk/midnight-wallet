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

Dust can sync from the indexer's event stream or from its projections. The testkit builds the event-based sync by
default and takes `DUST_SYNC=projections` to switch a whole run to the other one:

```bash
DUST_SYNC=projections yarn test-remote -- -t @healthcheck
```

An unrecognized value is rejected rather than defaulted, so a typo cannot report a run as covering one sync model while
it actually covered the other.

A test that needs a specific model regardless of the environment pins it in code, which overrides `DUST_SYNC`:

```ts
provideWallet(env, { ...projectionsDustSyncOptions, seed, syncCacheDir, filename });
```

Use `manualProjectionsDustSyncOptions` instead when the test drives each sync pass itself with `facade.doSync()`; the
plain `projectionsDustSyncOptions` leaves background synchronization on, so the usual state waiters work unchanged.

The two models disagree about the meaning of the single progress value a Dust snapshot carries, so a snapshot written by
one must never be restored into the other. Dust snapshots are therefore stored per model — switching models finds no
snapshot and rebuilds from scratch, rather than resuming from a position that is not a valid cursor. There is no cache
to clear by hand. The shielded and unshielded snapshots are model-independent and shared.

## Peer dependencies

- `vitest` — required (assertions and the environment hooks use it).
- `testcontainers` and `@midnightntwrk/wallet-sdk-utilities` — optional; only needed for the `/testcontainers` entry
  point.
