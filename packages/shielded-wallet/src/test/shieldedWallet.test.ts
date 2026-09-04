// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import * as ledger from '@midnightntwrk/ledger-v9';
import { InMemoryTransactionHistoryStorage, NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, Scope, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  CustomShieldedWallet,
  type CustomizedShieldedWallet,
  type DefaultShieldedConfiguration,
  V9_NATIVE_FORK_VERSION,
} from '../ShieldedWallet.js';
import { TransactionHistory, V2Builder, V2Tag } from '../v2/index.js';

const configuration: DefaultShieldedConfiguration = {
  networkId: NetworkId.NetworkId.Undeployed,
  indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(TransactionHistory.ShieldedTransactionHistoryEntrySchema),
  forkVersion: ProtocolVersion.V9NativeForkVersion,
};

/**
 * What the wallet asked of its runtime.
 *
 * @remarks
 *   The wallet under test is the single-variant composition, `CustomShieldedWallet` — what an application pinned to one
 *   protocol version builds, and the only shape these claims are about. A wallet spanning a boundary resolves key
 *   material per variant instead, and is driven end to end over real chains in `forkStart.test.ts`.
 *
 *   The runtime is stubbed rather than driven through a real migration because the behaviour under test is entirely the
 *   wallet's: which keys it holds on to, and how many watchers it registers. Provoking a real activation would test the
 *   runtime, which already has its own coverage.
 */
type RuntimeRecorder = {
  /** The start-aux each `dispatch` to `startSyncInBackground` was given, in order. */
  readonly dispatched: ledger.ZswapSecretKeys[];
  /** The start-aux the activation watcher restarted sync with, in order. */
  readonly resumed: ledger.ZswapSecretKeys[];
  /** One entry per `onVariantActivation` registration. */
  readonly watchers: ((variant: {
    startSyncInBackground: (aux: ledger.ZswapSecretKeys) => Effect.Effect<void>;
  }) => Effect.Effect<void>)[];
};

const makeRecorder = (): RuntimeRecorder => ({ dispatched: [], resumed: [], watchers: [] });

const walletWith = (
  recorder: RuntimeRecorder,
): Effect.Effect<{ wallet: CustomizedShieldedWallet; scope: Scope.CloseableScope }> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const WalletClass = CustomShieldedWallet<DefaultShieldedConfiguration>(
      configuration,
      new V2Builder().withDefaults(),
    );

    const runningVariant = {
      __polyTag__: V2Tag,
      startSyncInBackground: (aux: ledger.ZswapSecretKeys) =>
        Effect.sync(() => {
          recorder.dispatched.push(aux);
        }),
    };

    const stub = {
      stateChanges: Stream.empty,
      progress: Effect.succeed({ sourceGap: 0n, applyGap: 0n }),
      currentVariant: Effect.succeed(runningVariant),
      dispatch: (impl: Record<symbol, (variant: typeof runningVariant) => Effect.Effect<unknown>>) =>
        impl[V2Tag](runningVariant),
      onVariantActivation: (impl: Record<symbol, RuntimeRecorder['watchers'][number]>) =>
        Effect.sync(() => {
          recorder.watchers.push(impl[V2Tag]);
        }),
    };

    // Type casts required because: `Runtime.Runtime` is parameterised over the variant HList and its members are
    // typed with `Poly.PolyFunction`, which no structural stub can be inferred into — the five members above are the
    // whole interface, and each is exercised by the assertions below. The result is narrowed because
    // `BaseWalletClass`'s construct signature is declared to return the base `WalletLike`, so `new` on the class type
    // loses the shielded API; the production static factories narrow at exactly the same point.
    const wallet = new WalletClass(stub as never, scope) as CustomizedShieldedWallet;
    return { wallet, scope };
  });

/** Fires an activation at every registered watcher, recording which keys sync was restarted with. */
const activate = (recorder: RuntimeRecorder): Effect.Effect<void> =>
  Effect.forEach(
    recorder.watchers,
    (watcher) =>
      watcher({
        startSyncInBackground: (aux) =>
          Effect.sync(() => {
            recorder.resumed.push(aux);
          }),
      }),
    { discard: true },
  );

const keysFrom = (seed: number): ledger.ZswapSecretKeys => ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, seed));

describe('CustomShieldedWallet post-migration sync restart', () => {
  it('registers the activation watcher exactly once, however often start is called', async () => {
    const recorder = makeRecorder();
    const first = keysFrom(1);
    const second = keysFrom(2);

    await Effect.gen(function* () {
      const { wallet } = yield* walletWith(recorder);
      yield* Effect.promise(() => wallet.start(first));
      yield* Effect.promise(() => wallet.start(second));
    }).pipe(Effect.runPromise);

    // Registering per call would restart sync once per historical start on the next activation.
    expect(recorder.watchers.length).toBe(1);
    // Each start still dispatches, exactly as before.
    expect(recorder.dispatched).toEqual([first, second]);
  });

  it('restarts sync on the activated variant with the keys most recently started with', async () => {
    const recorder = makeRecorder();
    const first = keysFrom(1);
    const second = keysFrom(2);

    await Effect.gen(function* () {
      const { wallet } = yield* walletWith(recorder);
      yield* Effect.promise(() => wallet.start(first));
      yield* activate(recorder);
      yield* Effect.promise(() => wallet.start(second));
      yield* activate(recorder);
    }).pipe(Effect.runPromise);

    expect(recorder.resumed).toEqual([first, second]);
  });

  it('does not restart sync after stop, because the retained keys are released', async () => {
    const recorder = makeRecorder();
    const keys = keysFrom(1);

    await Effect.gen(function* () {
      const { wallet } = yield* walletWith(recorder);
      yield* Effect.promise(() => wallet.start(keys));
      yield* Effect.promise(() => wallet.stop());
      yield* activate(recorder);
    }).pipe(Effect.runPromise);

    expect(recorder.resumed).toEqual([]);
  });

  it('does not restart sync when a variant activates before start was ever called', async () => {
    const recorder = makeRecorder();

    await Effect.gen(function* () {
      yield* walletWith(recorder);
      yield* activate(recorder);
    }).pipe(Effect.runPromise);

    expect(recorder.watchers).toEqual([]);
    expect(recorder.resumed).toEqual([]);
  });
});

describe('V9_NATIVE_FORK_VERSION', () => {
  it('is the same value as ProtocolVersion.V9NativeForkVersion, kept only so existing imports keep working', () => {
    expect(V9_NATIVE_FORK_VERSION).toBe(ProtocolVersion.V9NativeForkVersion);
  });
});
