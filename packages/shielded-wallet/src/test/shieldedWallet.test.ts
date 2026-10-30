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
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  InMemoryTransactionHistoryStorage,
  NetworkId,
  ProtocolVersion,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, Scope, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import { type ShieldedKeysByEpoch } from '../ShieldedWallet.js';
import {
  type DefaultShieldedConfiguration,
  type ShieldedWalletAPI,
  V9_NATIVE_FORK_VERSION,
} from '../ShieldedWalletAPI.js';
import { CustomShieldedWallet, type CustomizedShieldedWallet } from '../SingleVariantShieldedWallet.js';
import { TransactionHistory, V2Builder, V2Tag } from '../v2/index.js';

const configuration: DefaultShieldedConfiguration = {
  networkId: NetworkId.NetworkId.Undeployed,
  indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(TransactionHistory.ShieldedTransactionHistoryEntrySchema),
  forks: ProtocolVersion.V9NativeForkSchedule,
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
  readonly dispatched: ledgerV9.ZswapSecretKeys[];
  /** The start-aux the activation watcher restarted sync with, in order. */
  readonly resumed: ledgerV9.ZswapSecretKeys[];
  /** One entry per `onVariantActivation` registration. */
  readonly watchers: ((variant: {
    startSyncInBackground: (aux: ledgerV9.ZswapSecretKeys) => Effect.Effect<void>;
  }) => Effect.Effect<void>)[];
  /** The TTL each transaction-building call reached the variant with, by call, in order. */
  readonly ttls: (readonly [call: string, ttl: Date | undefined])[];
};

const makeRecorder = (): RuntimeRecorder => ({ dispatched: [], resumed: [], watchers: [], ttls: [] });

/** What the stubbed variant hands back for every transaction it is asked to build: an empty transaction. */
const builtTransaction = (): ledgerV9.UnprovenTransaction =>
  ledgerV9.Transaction.fromParts(NetworkId.NetworkId.Undeployed);

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
      startSyncInBackground: (aux: ledgerV9.ZswapSecretKeys) =>
        Effect.sync(() => {
          recorder.dispatched.push(aux);
        }),
      balanceTransaction: (_keys: ledgerV9.ZswapSecretKeys, _tx: unknown, ttl?: Date) =>
        Effect.sync(() => {
          recorder.ttls.push(['balanceTransaction', ttl]);
          return builtTransaction();
        }),
      transferTransaction: (_keys: ledgerV9.ZswapSecretKeys, _outputs: unknown, ttl?: Date) =>
        Effect.sync(() => {
          recorder.ttls.push(['transferTransaction', ttl]);
          return builtTransaction();
        }),
      initSwap: (_keys: ledgerV9.ZswapSecretKeys, _inputs: unknown, _outputs: unknown, ttl?: Date) =>
        Effect.sync(() => {
          recorder.ttls.push(['initSwap', ttl]);
          return builtTransaction();
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

const keysFrom = (seed: number): ledgerV9.ZswapSecretKeys => ledgerV9.ZswapSecretKeys.fromSeed(Buffer.alloc(32, seed));

describe('CustomShieldedWallet post-migration sync restart', () => {
  it('registers the activation watcher exactly once, however often start is called', async () => {
    const recorder = makeRecorder();
    const first = keysFrom(1);
    const second = keysFrom(2);

    await Effect.gen(function* () {
      const { wallet } = yield* walletWith(recorder);
      yield* Effect.promise(() => wallet.start({ v9: first }));
      yield* Effect.promise(() => wallet.start({ v9: second }));
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
      yield* Effect.promise(() => wallet.start({ v9: first }));
      yield* activate(recorder);
      yield* Effect.promise(() => wallet.start({ v9: second }));
      yield* activate(recorder);
    }).pipe(Effect.runPromise);

    expect(recorder.resumed).toEqual([first, second]);
  });

  it('does not restart sync after stop, because the retained keys are released', async () => {
    const recorder = makeRecorder();
    const keys = keysFrom(1);

    await Effect.gen(function* () {
      const { wallet } = yield* walletWith(recorder);
      yield* Effect.promise(() => wallet.start({ v9: keys }));
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

describe('CustomShieldedWallet start', () => {
  it('starts from the ledger-v9 side of keys given for both ledger versions, as a facade hands them over', async () => {
    const recorder = makeRecorder();
    const v8Keys = ledgerV8.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1));
    const v9Keys = keysFrom(1);

    await Effect.gen(function* () {
      const { wallet } = yield* walletWith(recorder);
      // Held the way a facade holds it: a wallet it starts with one ledger version's keys per side of the boundary,
      // of which a single-variant wallet needs only the side its one variant runs on.
      const heldByFacade: ShieldedWalletAPI<ShieldedKeysByEpoch> = wallet;
      yield* Effect.promise(() => heldByFacade.start({ v8: v8Keys, v9: v9Keys }));
    }).pipe(Effect.runPromise);

    expect(recorder.dispatched).toEqual([v9Keys]);
  });
});

describe('CustomShieldedWallet building a transaction with a TTL', () => {
  it("should hand the transaction's TTL to the variant on every call that books coins, so the coins are held no longer than the transaction lives", async () => {
    const recorder = makeRecorder();
    const ttl = new Date('2026-10-08T12:10:00Z');
    const tx = WalletTransaction.adopt('Unproven', builtTransaction(), ProtocolVersion.MinSupportedVersion);

    await Effect.gen(function* () {
      const { wallet } = yield* walletWith(recorder);
      yield* Effect.promise(() => wallet.start({ v9: keysFrom(1) }));
      yield* Effect.promise(() => wallet.balanceTransaction(tx, ttl));
      yield* Effect.promise(() => wallet.transferTransaction([], ttl));
      yield* Effect.promise(() => wallet.initSwap({}, [], ttl));
    }).pipe(Effect.runPromise);

    expect(recorder.ttls).toEqual([
      ['balanceTransaction', ttl],
      ['transferTransaction', ttl],
      ['initSwap', ttl],
    ]);
  });

  it('should hand the variant no TTL when the caller gives none, so the booking keeps its full lifetime', async () => {
    const recorder = makeRecorder();
    const tx = WalletTransaction.adopt('Unproven', builtTransaction(), ProtocolVersion.MinSupportedVersion);

    await Effect.gen(function* () {
      const { wallet } = yield* walletWith(recorder);
      yield* Effect.promise(() => wallet.start({ v9: keysFrom(1) }));
      yield* Effect.promise(() => wallet.balanceTransaction(tx));
      yield* Effect.promise(() => wallet.transferTransaction([]));
      yield* Effect.promise(() => wallet.initSwap({}, []));
    }).pipe(Effect.runPromise);

    expect(recorder.ttls).toEqual([
      ['balanceTransaction', undefined],
      ['transferTransaction', undefined],
      ['initSwap', undefined],
    ]);
  });
});

describe('V9_NATIVE_FORK_VERSION', () => {
  it('is the same value as ProtocolVersion.V9NativeForkVersion, kept only so existing imports keep working', () => {
    expect(V9_NATIVE_FORK_VERSION).toBe(ProtocolVersion.V9NativeForkVersion);
  });
});
