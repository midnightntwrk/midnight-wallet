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

/**
 * Which time a Dust spend is dated at when the caller leaves it to the wallet.
 *
 * @remarks
 *   The node verifies a Dust spend's proof against the Dust tree roots it recorded at the spend's `ctime`, while the
 *   proof itself is built from the wallet's local trees. Dating a spend at the newest block is therefore only sound
 *   when the local trees hold exactly that block's roots. These tests drive `RunningV2Variant.balanceTransactions` with
 *   a wallet whose trees are one real Dust event behind (or ahead of) the block the indexer reports, and record the
 *   state and time the transacting capability is asked to spend with.
 */
import {
  type DustSecretKey,
  LedgerParameters,
  type ProofErasedTransaction,
  Transaction,
  type UnprovenTransaction,
} from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  Cause,
  Duration,
  Effect,
  Either,
  Exit,
  Fiber,
  Option,
  Scope,
  Stream,
  SubscriptionRef,
  TestClock,
  TestContext,
} from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';
import { chooseCoin, makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import { RunningV2Variant } from '../RunningV2Variant.js';
import { makeDefaultV2SerializationCapability } from '../Serialization.js';
import { BackgroundRepeat, type SyncService } from '../Sync.js';
import { type BlockData } from '../SyncSchema.js';
import { TransactingCapabilityImplementation } from '../Transacting.js';
import { type AnyTransaction } from '../types/index.js';
import { leBigintToHex } from '../Utils.js';
import { OtherWalletError, type WalletError } from '../WalletError.js';
import { buildDustChain, DUST_EVENT_COUNT, eventAt, fixtureSecretKey, freshWallet } from './dustEvents.js';

const networkId = NetworkId.NetworkId.Undeployed;
const TIP_TIME = new Date('2026-10-06T23:30:24Z');
const LATER_TIP_TIME = new Date('2026-10-06T23:30:30Z');
const TTL = new Date('2026-10-07T00:30:00Z');

type SpendCall = { readonly state: CoreWallet; readonly currentTime: Date };

/** The default capability, except that balancing records what it was asked to spend with and spends nothing. */
class RecordingTransacting extends TransactingCapabilityImplementation<ProofErasedTransaction> {
  readonly calls: SpendCall[] = [];

  override balanceTransactions(
    _secretKey: DustSecretKey,
    state: CoreWallet,
    _transactions: ReadonlyArray<AnyTransaction>,
    _ttl: Date,
    currentTime: Date,
    _ledgerParams: LedgerParameters,
  ): Either.Either<[UnprovenTransaction, CoreWallet], WalletError> {
    this.calls.push({ state, currentTime });
    return this.outcome(state);
  }

  protected outcome(state: CoreWallet): Either.Either<[UnprovenTransaction, CoreWallet], WalletError> {
    return Either.right([Transaction.fromParts(networkId), state]);
  }
}

/** Records like {@link RecordingTransacting}, then fails the way a wallet without enough Dust does. */
class FailingTransacting extends RecordingTransacting {
  protected override outcome(): Either.Either<[UnprovenTransaction, CoreWallet], WalletError> {
    return Either.left(new OtherWalletError({ message: 'not enough Dust' }));
  }
}

const makeRecordingTransacting = (
  Capability: typeof RecordingTransacting = RecordingTransacting,
): RecordingTransacting => {
  const keysCapability = makeDefaultKeysCapability();
  const coinsAndBalancesCapability = makeDefaultCoinsAndBalancesCapability(undefined, () => ({ keysCapability }));
  return new Capability(
    networkId,
    { feeBlocksMargin: 5 },
    () => chooseCoin,
    () => coinsAndBalancesCapability,
    () => keysCapability,
  );
};

type Roots = { readonly commitment: string; readonly generation: string };

/** The Dust tree roots of a wallet, encoded the way the indexer reports a block's roots. */
const rootsOf = (wallet: CoreWallet): Roots => {
  const commitment = wallet.state.commitmentTreeRoot();
  const generation = wallet.state.generatingTreeRoot();
  return {
    commitment: commitment === undefined ? '' : leBigintToHex(commitment),
    generation: generation === undefined ? '' : leBigintToHex(generation),
  };
};

const blockAt = (timestamp: Date, roots: Roots): BlockData => ({
  hash: 'block-hash',
  height: 1,
  protocolVersion: 0,
  ledgerParameters: LedgerParameters.initialParameters(),
  timestamp,
  zswapEndIndex: 0,
  dustCommitmentEndIndex: 0,
  dustGenerationEndIndex: 0,
  dustCommitmentMerkleTreeRoot: roots.commitment,
  dustGenerationMerkleTreeRoot: roots.generation,
});

/** A sync service with no updates whose newest block is the next of `blocks` on each call, then the last one forever. */
const syncServiceReporting = (blocks: readonly BlockData[]): SyncService<CoreWallet, null, never> => {
  const served = { count: 0 };
  return {
    backgroundRepeat: BackgroundRepeat.Once(),
    updates: () => Stream.empty,
    blockData: () =>
      Effect.sync(() => {
        const block = blocks[Math.min(served.count, blocks.length - 1)];
        served.count += 1;
        return block;
      }),
  };
};

const variantOver = (
  stateRef: SubscriptionRef.SubscriptionRef<CoreWallet>,
  scope: Scope.Scope,
  blocks: readonly BlockData[],
  transacting: RecordingTransacting,
): RunningV2Variant<string, never, ProofErasedTransaction, null> => {
  const keysCapability = makeDefaultKeysCapability();
  return new RunningV2Variant(
    scope,
    {
      stateRef,
      activationRange: ProtocolVersion.makeRange(
        ProtocolVersion.MinSupportedVersion,
        ProtocolVersion.MaxSupportedVersion,
      ),
    },
    {
      serializationCapability: makeDefaultV2SerializationCapability(),
      syncService: syncServiceReporting(blocks),
      syncCapability: { applyUpdate: (state) => [state, { changes: [], protocolVersion: 1 }] },
      transactingCapability: transacting,
      coinsAndBalancesCapability: makeDefaultCoinsAndBalancesCapability(undefined, () => ({ keysCapability })),
      keysCapability,
      coinSelection: chooseCoin,
      transactionHistoryService: { getTransactionDetails: () => Effect.die('unused'), put: () => Effect.void },
    },
  );
};

describe('RunningV2Variant.balanceTransactions spend time', () => {
  // `behind` holds every fixture Dust event but the last; `caughtUp` holds all of them. Built once: the fixture's
  // events are real chain events, so the two wallets' roots are real roots the indexer could report.
  const wallets: { behind?: CoreWallet; caughtUp?: CoreWallet } = {};

  beforeAll(async () => {
    const chain = await buildDustChain();
    const secretKey = fixtureSecretKey();
    const eventsUpTo = (count: number) => Array.from({ length: count }, (_, index) => eventAt(chain.eventBytes, index));
    const [behind] = CoreWallet.applyEventsWithChanges(
      freshWallet(),
      secretKey,
      eventsUpTo(DUST_EVENT_COUNT - 1),
      chain.syncTime,
    );
    const [caughtUp] = CoreWallet.applyEventsWithChanges(
      freshWallet(),
      secretKey,
      eventsUpTo(DUST_EVENT_COUNT),
      chain.syncTime,
    );
    // Every case below relies on the two wallets' roots being real, non-empty and different.
    expect(rootsOf(caughtUp).commitment).not.toBe('');
    expect(rootsOf(behind)).not.toEqual(rootsOf(caughtUp));
    wallets.behind = behind;
    wallets.caughtUp = caughtUp;
  }, 120_000);

  const behind = (): CoreWallet => wallets.behind!;
  const caughtUp = (): CoreWallet => wallets.caughtUp!;

  /** Starts balancing in a fiber against `initial`, under the test clock. */
  const balancing = (
    initial: CoreWallet,
    blocks: readonly BlockData[],
    currentTime?: Date,
    Capability: typeof RecordingTransacting = RecordingTransacting,
  ) =>
    Effect.gen(function* () {
      const stateRef = yield* SubscriptionRef.make(initial);
      const scope = yield* Scope.make();
      const transacting = makeRecordingTransacting(Capability);
      const variant = variantOver(stateRef, scope, blocks, transacting);
      const fiber = yield* Effect.fork(variant.balanceTransactions(fixtureSecretKey(), [], TTL, currentTime));
      return { stateRef, transacting, fiber };
    });

  it('should date the spend at the newest block when the local trees hold that block’s roots', async () => {
    const result = await Effect.gen(function* () {
      const { transacting, fiber } = yield* balancing(caughtUp(), [blockAt(TIP_TIME, rootsOf(caughtUp()))]);
      const exit = yield* Fiber.await(fiber);
      return { exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].currentTime).toEqual(TIP_TIME);
    expect(rootsOf(result.calls[0].state)).toEqual(rootsOf(caughtUp()));
  });

  it('should not spend from trees missing the newest block’s Dust events, so the proof never names roots it lacks', async () => {
    const result = await Effect.gen(function* () {
      const { stateRef, transacting, fiber } = yield* balancing(behind(), [blockAt(TIP_TIME, rootsOf(caughtUp()))]);
      yield* TestClock.adjust(Duration.millis(1));
      const callsWhileBehind = transacting.calls.length;

      // Sync delivers the missing event; balancing must then go through against the caught-up trees.
      yield* SubscriptionRef.set(stateRef, caughtUp());
      yield* TestClock.adjust(Duration.seconds(5));
      const exit = yield* Fiber.await(fiber);
      return { callsWhileBehind, exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(result.callsWhileBehind).toBe(0);
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].currentTime).toEqual(TIP_TIME);
    expect(rootsOf(result.calls[0].state)).toEqual(rootsOf(caughtUp()));
  });

  it('should read the newest block again when the local trees are ahead of it, and date the spend at the block they match', async () => {
    const result = await Effect.gen(function* () {
      // The indexer's HTTP view first reports a block whose events the wallet has already gone past.
      const { transacting, fiber } = yield* balancing(caughtUp(), [
        blockAt(TIP_TIME, rootsOf(behind())),
        blockAt(LATER_TIP_TIME, rootsOf(caughtUp())),
      ]);
      yield* TestClock.adjust(Duration.seconds(5));
      const exit = yield* Fiber.await(fiber);
      return { exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].currentTime).toEqual(LATER_TIP_TIME);
  });

  it('should fail with a sync error, spending nothing, when the local trees never reach the newest block’s roots', async () => {
    const result = await Effect.gen(function* () {
      const { transacting, fiber } = yield* balancing(behind(), [blockAt(TIP_TIME, rootsOf(caughtUp()))]);
      yield* TestClock.adjust(Duration.minutes(10));
      const exit = yield* Fiber.await(fiber);
      return { exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(result.calls).toHaveLength(0);
    const failure = Exit.isFailure(result.exit) ? Cause.failureOption(result.exit.cause) : Option.none();
    expect(Option.map(failure, (error) => error._tag)).toEqual(Option.some('Wallet.Sync'));
  });

  it('should wait when only the generation tree is behind the newest block, because the proof covers both trees', async () => {
    const result = await Effect.gen(function* () {
      const reported = { commitment: rootsOf(caughtUp()).commitment, generation: 'a-generation-root-not-held-locally' };
      const { transacting, fiber } = yield* balancing(caughtUp(), [blockAt(TIP_TIME, reported)]);
      yield* TestClock.adjust(Duration.minutes(10));
      const exit = yield* Fiber.await(fiber);
      return { exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(result.calls).toHaveLength(0);
    expect(Exit.isFailure(result.exit)).toBe(true);
  });

  it('should fail at once when balancing itself fails, because only trees behind the block are worth waiting for', async () => {
    const result = await Effect.gen(function* () {
      const { transacting, fiber } = yield* balancing(
        caughtUp(),
        [blockAt(TIP_TIME, rootsOf(caughtUp()))],
        undefined,
        FailingTransacting,
      );
      yield* TestClock.adjust(Duration.minutes(10));
      const exit = yield* Fiber.await(fiber);
      return { exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(result.calls).toHaveLength(1);
    const failure = Exit.isFailure(result.exit) ? Cause.failureOption(result.exit.cause) : Option.none();
    expect(Option.map(failure, (error) => error._tag)).toEqual(Option.some('Wallet.Other'));
  });

  it('should date the spend at the newest block at once when the block reports no Dust roots, as the simulator’s do', async () => {
    const result = await Effect.gen(function* () {
      const { transacting, fiber } = yield* balancing(behind(), [
        blockAt(TIP_TIME, { commitment: '', generation: '' }),
      ]);
      const exit = yield* Fiber.await(fiber);
      return { exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].currentTime).toEqual(TIP_TIME);
  });

  it('should use a time the caller passes at once, because the caller then owns the spend time', async () => {
    const callerTime = new Date('2026-10-06T23:29:54Z');
    const result = await Effect.gen(function* () {
      const { transacting, fiber } = yield* balancing(behind(), [blockAt(TIP_TIME, rootsOf(caughtUp()))], callerTime);
      const exit = yield* Fiber.await(fiber);
      return { exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].currentTime).toEqual(callerTime);
  });
});
