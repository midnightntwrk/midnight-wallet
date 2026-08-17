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
import { IndexerLiveness } from '@midnightntwrk/wallet-sdk-abstractions';
import { Cause, Duration, Effect, Exit, Option, Schedule, Scope, Stream, SubscriptionRef } from 'effect';
import { describe, expect, it } from 'vitest';
import { type PublicKey } from '../../KeyStore.js';
import { CoreWallet } from '../CoreWallet.js';
import { RunningV1Variant } from '../RunningV1Variant.js';
import { makeDefaultSyncCapability, type SyncService } from '../Sync.js';
import { type SyncUpdate } from '../SyncSchema.js';
import { type TransactionHistoryService } from '../TransactionHistory.js';
import { SyncWalletError } from '../WalletError.js';

const publicKey: PublicKey = {
  publicKey: 'e6d8b9c1a2f3',
  addressHex: '0102030405',
  address: 'mn_addr_undeployed1testaddress',
};

const noOpHistory: TransactionHistoryService = { put: () => Effect.void };

const syncCapability = makeDefaultSyncCapability(
  { indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v1/graphql' } },
  () => ({ transactionHistoryService: noOpHistory }),
);

/** A subscription that reports a fully synchronized wallet, then dies — an indexer WebSocket dropping mid-session. */
const dyingSyncService: SyncService<CoreWallet, SyncUpdate> = {
  updates: () =>
    Stream.concat(
      Stream.make<SyncUpdate[]>(
        {
          type: 'IndexerLiveness',
          verdict: IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n }),
        },
        { type: 'UnshieldedTransactionsProgress', highestTransactionId: 0 },
      ),
      Stream.fail(new SyncWalletError({ message: 'websocket closed' })),
    ),
};

describe('RunningV1Variant.startSync', () => {
  it('should clear isConnected when the sync stream fails, so a dead subscription cannot keep reporting synced', async () => {
    // `isConnected` was written true on every progress update and cleared nowhere: it latched. When the subscription
    // dropped, the stream failed into its retry backoff with the wallet still holding isConnected: true, a caught-up
    // cursor, and the last liveness verdict — so `isCompleteWithin()` reported a wallet connected to nothing as
    // synchronized, for up to the full backoff (capped at two minutes) or an entire indexer outage. The liveness check
    // cannot catch this one: the indexer itself may be healthy — it is this wallet's subscription that is dead — so
    // the connection flag is the only truthful signal, and it must go false the moment the stream does.
    const program = Effect.gen(function* () {
      const stateRef = yield* SubscriptionRef.make(CoreWallet.init(publicKey, 'undeployed'));
      const scope = yield* Scope.make();

      const variant = new RunningV1Variant(
        scope,
        { stateRef },
        // Type cast required because: startSync exercises only the sync service and capability; building the full
        // context would drag transacting, serialization and key material into a test about a connection flag.
        {
          syncService: dyingSyncService,
          syncCapability,
          transactionHistoryService: noOpHistory,
        } as unknown as RunningV1Variant.Context<string, SyncUpdate>,
      );

      // Subscribed before sync starts, so no intermediate state can slip past between replay and live changes.
      const firstDisconnectAfterConnect = yield* Effect.fork(
        stateRef.changes.pipe(
          Stream.map((wallet) => wallet.progress),
          // Drop everything up to and including the moment the update latched the flag true...
          Stream.dropUntil((progress) => progress.isConnected),
          // ...then wait for it to be cleared. Carrying the whole progress out, so completion is asserted on the same
          // state the flag was observed on.
          Stream.filter((progress) => !progress.isConnected),
          Stream.runHead,
        ),
      );
      yield* Effect.yieldNow();

      yield* variant.startSyncInBackground().pipe(Effect.provideService(Scope.Scope, scope));

      const progressAfterFailure = yield* firstDisconnectAfterConnect.await.pipe(
        Effect.flatten,
        // Both abnormal endings are defects, not expected failures: the state stream cannot end while its ref lives,
        // and the timeout firing is precisely the bug under test.
        Effect.flatMap(Option.match({ onNone: () => Effect.dieMessage('state stream ended'), onSome: Effect.succeed })),
        Effect.timeoutFailCause({
          duration: Duration.seconds(3),
          onTimeout: () => Cause.die(new Error('isConnected was never cleared after the sync stream failed')),
        }),
      );

      yield* Scope.close(scope, Exit.void);

      return progressAfterFailure;
    });

    const progress = await Effect.runPromise(Effect.scoped(program));

    expect(progress.isConnected).toBe(false);
    // The cursor is caught up and the last verdict is InSync — without the cleared flag, this wallet would count as
    // fully synchronized while connected to nothing. This is the assertion the whole feature's premise implies.
    expect(progress.isStrictlyComplete()).toBe(false);
  });

  it(
    'should build the liveness feed once at wallet scope, so an indexer-stream retry does not restart the poller',
    { timeout: 10_000 },
    async () => {
      // `updates()` fails and is rebuilt by the variant's retry — that is its contract. The liveness feed must not be
      // torn down with it: rebuilding it on every retry reconnects its node client each time and silences verdicts
      // during exactly the windows — indexer outages — the check exists for. The feed's lifetime is the wallet's.
      const builds = { indexer: 0, liveness: 0 };

      const retryingSyncService: SyncService<CoreWallet, SyncUpdate> = {
        updates: () => {
          builds.indexer += 1;
          return Stream.concat(
            Stream.make<SyncUpdate[]>({ type: 'UnshieldedTransactionsProgress', highestTransactionId: 0 }),
            Stream.fail(new SyncWalletError({ message: 'websocket closed' })),
          );
        },
        livenessUpdates: () => {
          builds.liveness += 1;
          return Stream.concat(
            Stream.make<SyncUpdate[]>({
              type: 'IndexerLiveness',
              verdict: IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n }),
            }),
            // Held open: a real verdict stream never ends, and an ending one would mask a feed that was rebuilt.
            Stream.never,
          );
        },
      };

      const program = Effect.gen(function* () {
        const stateRef = yield* SubscriptionRef.make(CoreWallet.init(publicKey, 'undeployed'));
        const scope = yield* Scope.make();

        const variant = new RunningV1Variant(
          scope,
          { stateRef },
          // Type cast required because: startSync exercises only the sync service and capability; building the full
          // context would drag transacting, serialization and key material into a test about feed ownership.
          {
            syncService: retryingSyncService,
            syncCapability,
            transactionHistoryService: noOpHistory,
          } as unknown as RunningV1Variant.Context<string, SyncUpdate>,
        );

        const verdictArrived = yield* Effect.fork(
          stateRef.changes.pipe(
            Stream.filter((wallet) => IndexerLiveness.isInSync(wallet.progress.indexerLiveness)),
            Stream.runHead,
          ),
        );
        yield* Effect.yieldNow();

        yield* variant.startSyncInBackground().pipe(Effect.provideService(Scope.Scope, scope));

        // Wait through at least one retry of the indexer stream — the rebuild the liveness feed must survive.
        yield* Effect.sync(() => builds.indexer).pipe(
          Effect.repeat({ until: (count) => count >= 2, schedule: Schedule.spaced(Duration.millis(50)) }),
          Effect.timeoutFailCause({
            duration: Duration.seconds(8),
            onTimeout: () => Cause.die(new Error('the indexer stream was never retried')),
          }),
        );

        yield* verdictArrived.await.pipe(
          Effect.flatten,
          Effect.flatMap(
            Option.match({ onNone: () => Effect.dieMessage('state stream ended'), onSome: Effect.succeed }),
          ),
          Effect.timeoutFailCause({
            duration: Duration.seconds(3),
            onTimeout: () => Cause.die(new Error('no liveness verdict ever reached the wallet state')),
          }),
        );

        yield* Scope.close(scope, Exit.void);

        return builds;
      });

      const observed = await Effect.runPromise(Effect.scoped(program));

      expect(observed.indexer).toBeGreaterThanOrEqual(2);
      expect(observed.liveness).toBe(1);
    },
  );
});
