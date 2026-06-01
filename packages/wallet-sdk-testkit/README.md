# @midnight-ntwrk/wallet-sdk-testkit

Reusable wallet-SDK test harness, extracted from `packages/e2e-tests`. Provides environment
provisioning, wallet bootstrapping, sync waiters, and tx-history assertions as a published package
so downstream consumers (e.g. monitoring / healthcheck suites) can write their own test scenarios
against the same harness instead of vendoring copies of these files.

## What's here

| Area | Exports |
| --- | --- |
| Environment | `createRemoteEnvironment`, `NETWORK_PRESETS`, `makeEnvironment`, `WalletTestEnvironment`, `ResolvedEndpoints` |
| Environment (Docker) | `createTestContainersEnvironment` — from `@midnight-ntwrk/wallet-sdk-testkit/testcontainers` |
| Wallet | `provideWallet`, `initWalletWithSeed`, `saveState`, `WalletInit` |
| Seeds | `getShieldedSeed`, `getUnshieldedSeed`, `getDustSeed` |
| Sync waiters | `waitForSyncUnshielded`, `waitForDustBalance`, `waitForTxInHistory`, … |
| Assertions | `expectSenderShieldedTxHistory`, `expectReceiverUnshieldedTxHistory`, … |
| Addresses | `validateNetworkInAddress`, `getShieldedAddress`, `getUnshieldedAddress` |
| Vitest glue | `useWalletTestEnvironment`, `installRetryLogging` |
| Logging | `logger`, `setLogger`, `getLogger` |

## Key change from `e2e-tests`

The old `TestContainersFixture` resolved endpoints from `process.env` (`NETWORK`, `PROOF_SERVER_URL`,
`SYNC_CACHE`) and mapped container ports. That coupling is gone: a `WalletTestEnvironment` now carries
fully-resolved `endpoints`, produced either by `createTestContainersEnvironment` (Docker) or
`createRemoteEnvironment` (no Docker, point at an already-running network). Downstream consumers no
longer need to patch this file to inject a proof-server URL.

## Usage — remote network, no Docker

```ts
import { afterAll } from 'vitest';
import {
  createRemoteEnvironment,
  useWalletTestEnvironment,
  provideWallet,
  waitForDustBalance,
} from '@midnight-ntwrk/wallet-sdk-testkit';

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
import { useWalletTestEnvironment } from '@midnight-ntwrk/wallet-sdk-testkit';
import { createTestContainersEnvironment } from '@midnight-ntwrk/wallet-sdk-testkit/testcontainers';

const getEnv = useWalletTestEnvironment(() => createTestContainersEnvironment({ network: 'undeployed' }));
```

## Peer dependencies

- `vitest` — required (assertions and the environment hooks use it).
- `testcontainers` and `@midnight-ntwrk/wallet-sdk-utilities` — optional; only needed for the
  `/testcontainers` entry point.
