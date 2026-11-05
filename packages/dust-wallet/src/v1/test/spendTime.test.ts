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
 *   when the local trees hold exactly that block's roots. The V1 variant syncs by events only, which keep no block
 *   height, so it has no block of its own to fall back on. These tests drive `RunningV1Variant.balanceTransactions`
 *   with a wallet whose trees are one real Dust event behind (or ahead of) the block the indexer reports, and record
 *   the state and time the transacting capability is asked to spend with.
 */
import {
  type DustSecretKey,
  LedgerParameters,
  type ProofErasedTransaction,
  Transaction,
  type UnprovenTransaction,
} from '@midnight-ntwrk/ledger-v8';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { ScaleBigInt } from '@midnightntwrk/wallet-sdk-address-format';
import {
  Cause,
  Duration,
  Effect,
  Either,
  Exit,
  Fiber,
  Layer,
  Logger,
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
import { RunningV1Variant } from '../RunningV1Variant.js';
import { makeDefaultV1SerializationCapability } from '../Serialization.js';
import { BackgroundRepeat, type BlockData, type SyncService } from '../Sync.js';
import { TransactingCapabilityImplementation } from '../Transacting.js';
import { type AnyTransaction } from '../types/index.js';
import { dustTreeRoots, type DustTreeRoots } from '../Utils.js';
import { OtherWalletError, type WalletError } from '../WalletError.js';
import { buildDustChain, DUST_EVENT_COUNT, eventAt, fixtureSecretKey, freshWallet } from './dustEvents.js';

const networkId = NetworkId.NetworkId.Undeployed;
const TIP_TIME = new Date('2026-10-06T23:30:24Z');
const LATER_TIP_TIME = new Date('2026-10-06T23:30:30Z');
const OWN_BLOCK_TIME = new Date('2026-10-06T23:30:12Z');
const TTL = new Date('2026-10-07T00:30:00Z');
const TIP_HEIGHT = 8;
const LATER_TIP_HEIGHT = 9;
const OWN_HEIGHT = 7;
const NOT_HELD = 'a-root-not-held-locally';

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

/** The Dust tree roots of a wallet, encoded the way the indexer reports a block's roots. */
const rootsOf = (wallet: CoreWallet): DustTreeRoots => dustTreeRoots(wallet.state);

/** SCALE-compact hex written out by hand, so the encoding under test is checked against something other than itself. */
const scaleHex = (n: bigint | undefined): string =>
  n === undefined ? '' : Buffer.from(ScaleBigInt.encode(n)).toString('hex');

/**
 * A block at `timestamp`. Without `roots` it reports none, as the simulator's blocks do and as an indexer block with
 * null roots decodes to; a `roots` field left `undefined` reports that one root only.
 */
const blockAt = (
  timestamp: Date,
  roots?: { readonly commitment?: string; readonly generation?: string },
  height: number = TIP_HEIGHT,
): BlockData => ({
  hash: `block-hash-${height}`,
  height,
  protocolVersion: 0,
  ledgerParameters: LedgerParameters.initialParameters(),
  timestamp,
  ...(roots?.commitment === undefined ? {} : { dustCommitmentMerkleTreeRoot: roots.commitment }),
  ...(roots?.generation === undefined ? {} : { dustGenerationMerkleTreeRoot: roots.generation }),
});

/**
 * A sync service with no updates. Its newest block is the next of `tips` on each call, then the last one forever; a
 * block at a given height is the one in `pastBlocks` at that height.
 */
const syncServiceReporting = (
  tips: readonly BlockData[],
  pastBlocks: readonly BlockData[],
): SyncService<CoreWallet, null, never> => {
  const served = { count: 0 };
  return {
    backgroundRepeat: BackgroundRepeat.Once(),
    updates: () => Stream.empty,
    blockData: (height?: number) => {
      if (height === undefined) {
        return Effect.sync(() => {
          const block = tips[Math.min(served.count, tips.length - 1)];
          served.count += 1;
          return block;
        });
      }
      const past = pastBlocks.find((block) => block.height === height);
      return past === undefined
        ? Effect.fail(new OtherWalletError({ message: `no block at height ${height}` }))
        : Effect.succeed(past);
    },
  };
};

const variantOver = (
  stateRef: SubscriptionRef.SubscriptionRef<CoreWallet>,
  scope: Scope.Scope,
  tips: readonly BlockData[],
  pastBlocks: readonly BlockData[],
  transacting: RecordingTransacting,
): RunningV1Variant<string, never, ProofErasedTransaction, null> => {
  const keysCapability = makeDefaultKeysCapability();
  return new RunningV1Variant(
    scope,
    {
      stateRef,
      activationRange: ProtocolVersion.makeRange(
        ProtocolVersion.MinSupportedVersion,
        ProtocolVersion.MaxSupportedVersion,
      ),
    },
    {
      serializationCapability: makeDefaultV1SerializationCapability(),
      syncService: syncServiceReporting(tips, pastBlocks),
      syncCapability: { applyUpdate: (state) => [state, { changes: [], protocolVersion: 1 }] },
      transactingCapability: transacting,
      coinsAndBalancesCapability: makeDefaultCoinsAndBalancesCapability(undefined, () => ({ keysCapability })),
      keysCapability,
      coinSelection: chooseCoin,
      transactionHistoryService: { getTransactionDetails: () => Effect.die('unused'), put: () => Effect.void },
    },
  );
};

const failureTagOf = (exit: Exit.Exit<unknown, WalletError>): Option.Option<string> =>
  Exit.isFailure(exit) ? Option.map(Cause.failureOption(exit.cause), (error) => error._tag) : Option.none();

describe('RunningV1Variant.balanceTransactions spend time', () => {
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
    // Every case below relies on the two wallets' roots being real, non-empty, different, and encoded as the indexer
    // encodes them.
    expect(rootsOf(caughtUp)).toEqual({
      commitment: scaleHex(caughtUp.state.commitmentTreeRoot()),
      generation: scaleHex(caughtUp.state.generatingTreeRoot()),
    });
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
    tips: readonly BlockData[],
    options: {
      readonly currentTime?: Date;
      readonly Capability?: typeof RecordingTransacting;
      readonly pastBlocks?: readonly BlockData[];
    } = {},
  ) =>
    Effect.gen(function* () {
      const stateRef = yield* SubscriptionRef.make(initial);
      const scope = yield* Scope.make();
      const transacting = makeRecordingTransacting(options.Capability);
      const variant = variantOver(stateRef, scope, tips, options.pastBlocks ?? [], transacting);
      const fiber = yield* Effect.fork(variant.balanceTransactions(fixtureSecretKey(), [], TTL, options.currentTime));
      return { stateRef, transacting, fiber };
    });

  it('should date the spend at the newest block when the local trees hold that block’s roots, because the node then finds the roots the proof names', async () => {
    const result = await Effect.gen(function* () {
      const { transacting, fiber } = yield* balancing(caughtUp(), [blockAt(TIP_TIME, rootsOf(caughtUp()))]);
      yield* TestClock.adjust(Duration.millis(1));
      const exit = yield* Fiber.poll(fiber);
      return { exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(Option.map(result.exit, Exit.isSuccess)).toEqual(Option.some(true));
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

  it('should wait when only the commitment tree is behind the newest block, because other wallets’ spends move that tree alone', async () => {
    const result = await Effect.gen(function* () {
      const reported = { commitment: NOT_HELD, generation: rootsOf(caughtUp()).generation };
      const { transacting, fiber } = yield* balancing(caughtUp(), [blockAt(TIP_TIME, reported)]);
      yield* TestClock.adjust(Duration.seconds(1));
      const whileWaiting = yield* Fiber.poll(fiber);
      yield* TestClock.adjust(Duration.minutes(10));
      const exit = yield* Fiber.await(fiber);
      return { whileWaiting, exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(Option.isNone(result.whileWaiting)).toBe(true);
    expect(result.calls).toHaveLength(0);
    expect(failureTagOf(result.exit)).toEqual(Option.some('Wallet.Sync'));
  });

  it('should wait when only the generation tree is behind the newest block, because the proof covers both trees', async () => {
    const result = await Effect.gen(function* () {
      const reported = { commitment: rootsOf(caughtUp()).commitment, generation: NOT_HELD };
      const { transacting, fiber } = yield* balancing(caughtUp(), [blockAt(TIP_TIME, reported)]);
      yield* TestClock.adjust(Duration.seconds(1));
      const whileWaiting = yield* Fiber.poll(fiber);
      yield* TestClock.adjust(Duration.minutes(10));
      const exit = yield* Fiber.await(fiber);
      return { whileWaiting, exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(Option.isNone(result.whileWaiting)).toBe(true);
    expect(result.calls).toHaveLength(0);
    expect(failureTagOf(result.exit)).toEqual(Option.some('Wallet.Sync'));
  });

  it('should read the newest block again when the local trees are ahead of it, and date the spend at the block they match, because the indexer’s view can trail the wallet', async () => {
    const result = await Effect.gen(function* () {
      // The indexer's HTTP view first reports a block whose events the wallet has already gone past.
      const { transacting, fiber } = yield* balancing(caughtUp(), [
        blockAt(TIP_TIME, rootsOf(behind())),
        blockAt(LATER_TIP_TIME, rootsOf(caughtUp()), LATER_TIP_HEIGHT),
      ]);
      yield* TestClock.adjust(Duration.seconds(5));
      const exit = yield* Fiber.await(fiber);
      return { exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].currentTime).toEqual(LATER_TIP_TIME);
    expect(Exit.isSuccess(result.exit) ? result.exit.value.blockData.height : undefined).toBe(LATER_TIP_HEIGHT);
  });

  it('should keep waiting for two minutes, so a sync that falls briefly behind can still deliver the roots', async () => {
    const result = await Effect.gen(function* () {
      const { stateRef, transacting, fiber } = yield* balancing(behind(), [blockAt(TIP_TIME, rootsOf(caughtUp()))]);
      yield* TestClock.adjust(Duration.seconds(119));
      const at119Seconds = yield* Fiber.poll(fiber);
      yield* SubscriptionRef.set(stateRef, caughtUp());
      yield* TestClock.adjust(Duration.seconds(1));
      const exit = yield* Fiber.poll(fiber);
      return { at119Seconds, exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(Option.isNone(result.at119Seconds)).toBe(true);
    expect(Option.map(result.exit, Exit.isSuccess)).toEqual(Option.some(true));
    expect(result.calls).toHaveLength(1);
  });

  it('should stop waiting once two minutes have passed, because callers rely on the documented bound', async () => {
    const result = await Effect.gen(function* () {
      const { fiber } = yield* balancing(behind(), [blockAt(TIP_TIME, rootsOf(caughtUp()))]);
      yield* TestClock.adjust(Duration.seconds(121));
      return yield* Fiber.poll(fiber);
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(Option.flatMap(result, failureTagOf)).toEqual(Option.some('Wallet.Sync'));
  });

  it('should fail with a sync error naming both root pairs, spending nothing, when the local trees never reach the newest block’s roots, so lag and a broken encoding can be told apart', async () => {
    const result = await Effect.gen(function* () {
      const { transacting, fiber } = yield* balancing(behind(), [blockAt(TIP_TIME, rootsOf(caughtUp()))]);
      yield* TestClock.adjust(Duration.minutes(10));
      const exit = yield* Fiber.poll(fiber);
      return { exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(result.calls).toHaveLength(0);
    const failure = Option.flatMap(result.exit, (exit) =>
      Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none(),
    );
    expect(Option.map(failure, (error) => error._tag)).toEqual(Option.some('Wallet.Sync'));
    expect(Option.map(failure, (error) => error.cause)).toEqual(
      Option.some(
        expect.objectContaining({
          _tag: 'DustTreesNotAtBlock',
          blockHeight: TIP_HEIGHT,
          local: rootsOf(behind()),
          reported: rootsOf(caughtUp()),
        }),
      ),
    );
  });

  it('should fail at once when balancing itself fails, because only trees not at the block’s roots are worth waiting for', async () => {
    const result = await Effect.gen(function* () {
      const { transacting, fiber } = yield* balancing(caughtUp(), [blockAt(TIP_TIME, rootsOf(caughtUp()))], {
        Capability: FailingTransacting,
      });
      yield* TestClock.adjust(Duration.millis(1));
      const exit = yield* Fiber.poll(fiber);
      return { exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(result.calls).toHaveLength(1);
    expect(Option.flatMap(result.exit, failureTagOf)).toEqual(Option.some('Wallet.Other'));
  });

  it('should not fall back to a block of its own, because the V1 variant syncs by events, which keep no block height', async () => {
    const result = await Effect.gen(function* () {
      const wallet = CoreWallet.updateProgress(caughtUp(), { highestIndex: BigInt(OWN_HEIGHT) });
      const { transacting, fiber } = yield* balancing(
        wallet,
        [blockAt(TIP_TIME, { commitment: NOT_HELD, generation: NOT_HELD })],
        { pastBlocks: [blockAt(OWN_BLOCK_TIME, rootsOf(caughtUp()), OWN_HEIGHT)] },
      );
      yield* TestClock.adjust(Duration.seconds(1));
      const exit = yield* Fiber.poll(fiber);
      return { exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(Option.isNone(result.exit)).toBe(true);
    expect(result.calls).toHaveLength(0);
  });

  it('should wait when the newest block reports one root and not the other, because a half-reported block still names a root the trees must hold', async () => {
    const result = await Effect.gen(function* () {
      const { transacting, fiber } = yield* balancing(caughtUp(), [
        blockAt(TIP_TIME, { commitment: rootsOf(caughtUp()).commitment }),
      ]);
      yield* TestClock.adjust(Duration.seconds(1));
      const exit = yield* Fiber.poll(fiber);
      return { exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(Option.isNone(result.exit)).toBe(true);
    expect(result.calls).toHaveLength(0);
  });

  it('should date the spend at the newest block at once, with a warning, when the block reports no Dust roots, so a source that cannot report them still works and a real one that stops is noticed', async () => {
    const logged: Array<{ readonly level: string; readonly message: string }> = [];
    const recordingLogger = Logger.make(({ logLevel, message }) => {
      logged.push({ level: logLevel.label, message: Array.isArray(message) ? message.join(' ') : String(message) });
    });
    const result = await Effect.gen(function* () {
      const { transacting, fiber } = yield* balancing(behind(), [blockAt(TIP_TIME)]);
      yield* TestClock.adjust(Duration.millis(1));
      const exit = yield* Fiber.poll(fiber);
      return { exit, calls: transacting.calls };
    }).pipe(
      Effect.provide(Layer.merge(TestContext.TestContext, Logger.replace(Logger.defaultLogger, recordingLogger))),
      Effect.runPromise,
    );

    expect(Option.map(result.exit, Exit.isSuccess)).toEqual(Option.some(true));
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].currentTime).toEqual(TIP_TIME);
    expect(logged.filter((entry) => entry.level === 'WARN')).toHaveLength(1);
  });

  it('should use a time the caller passes at once, because the caller then owns the spend time', async () => {
    const callerTime = new Date('2026-10-06T23:29:54Z');
    const result = await Effect.gen(function* () {
      const { transacting, fiber } = yield* balancing(behind(), [blockAt(TIP_TIME, rootsOf(caughtUp()))], {
        currentTime: callerTime,
      });
      yield* TestClock.adjust(Duration.millis(1));
      const exit = yield* Fiber.poll(fiber);
      return { exit, calls: transacting.calls };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(Option.map(result.exit, Exit.isSuccess)).toEqual(Option.some(true));
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].currentTime).toEqual(callerTime);
  });
});
