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
//
// The hard-fork crossing, as a test. One facade wallet syncs a chain whose genesis carries the
// pre-fork (ledger 8) runtime, the fork is enacted through governance while it watches, and the
// wallet has to cross to its post-fork variants with the same money it had before.
//
// It is the automated form of the scenario first run by hand: the wallet half, plus the chain-level
// checks that run's `hardfork.sh verify` step made. It is its own vitest project (`fork`) rather than
// an `*.undeployed.test.ts`, because it needs a different stack and must never be retried: a retry
// would re-run against an already-forked chain and fail for an unrelated reason.
import * as rx from 'rxjs';
import { Buffer } from 'node:buffer';
import { inspect } from 'node:util';
import { Cause, Either, Option, Runtime } from 'effect';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
// Both ledgers, because this file is the one that authors on both sides of the boundary: the spend before the fork is
// ledger-v8's transaction and everything from `re-registers its NIGHT` onwards is ledger-v9's.
import * as preForkLedger from '@midnight-ntwrk/ledger-v8';
import * as ledger from '@midnightntwrk/ledger-v9';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type WalletSeeds as WalletSeedsType, WalletSeeds } from '@midnightntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  PublicKey,
  type UnshieldedKeystore,
  UnshieldedWallet,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import {
  asPreForkDustParameters,
  CustomForkingDustWallet,
  type DefaultDustConfiguration,
  DustWallet,
  makeEventLessSyncCapability,
  makeEventLessSyncService,
} from '@midnightntwrk/wallet-sdk-dust-wallet';
import { V1Builder } from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
import { Migration, V2Builder } from '@midnightntwrk/wallet-sdk-dust-wallet/v2';
import {
  type DefaultConfiguration,
  type FacadeState,
  type WalletEntry,
  WalletFacade,
} from '@midnightntwrk/wallet-sdk-facade';
import { type ForkFixture, useForkFixture } from './fork-fixture.js';
import * as utils from './utils.js';
import { carried } from './helpers/transactions.js';
import { rootsEqual, sameDustCoins } from './helpers/dustComparison.js';
import { logger } from './logger.js';

/** The dev preset's funded account. */
const FUNDED_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/** An account with nothing on it, which is what makes the post-fork spends' arrival assertions exact. */
const RECEIVER_SEED = 'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82';

/** A second empty account, for the spend made before the boundary: the post-fork receiver must still start at zero. */
const V8_RECEIVER_SEED = '4c1d1e0e9a2a4a3f8b5c6d7e8f90112233445566778899aabbccddeeff001122';

/**
 * Native NIGHT. Written out rather than read from a ledger binding on purpose: the wallet holds this balance on both
 * sides of the boundary, so the assertion must not be phrased in either ledger's terms.
 */
const NIGHT = '0000000000000000000000000000000000000000000000000000000000000000';

/** The spec version the `1.0.1` runtime reports, and therefore what genesis must be carrying. */
const PRE_FORK_SPEC_VERSION = 1_000_000;

/** How long the wallet is given to notice the fork, migrate all three sub-wallets, and re-sync. */
const CROSSING_TIMEOUT_MS = 8 * 60 * 1000;

/** How long the re-registration is given to settle and the first post-fork dust to appear. */
const DUST_TIMEOUT_MS = 4 * 60 * 1000;

/** How long to leave between attempts at a transaction the wallet could not yet pay for. */
const DUST_POLL_MS = 5 * 1000;

/** How long a post-fork spend is given to be proven, included, and observed by both sides. */
const SPEND_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * What each post-fork spend moves. Deliberately tiny: the question these tests ask is whether money that crossed the
 * boundary can be spent at all, not how much of it.
 */
const TRANSFER_AMOUNT = 1_000n;

/** How long a transaction these tests build stays valid. */
const TTL_MS = 60 * 60 * 1000;

/** A state reading together with the phase sequence observed up to it. */
type Tracked = Readonly<{ state: FacadeState | undefined; phases: readonly string[] }>;

const asJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? `${item}n` : item));

const phaseOf = (state: FacadeState): string =>
  state.protocol._tag === 'Settled'
    ? `Settled@${state.protocol.version}`
    : `Crossing ${state.protocol.from}->${state.protocol.to} behind=[${state.protocol.behind.join(',')}]`;

const summarize = (state: FacadeState): string =>
  asJson({
    phase: phaseOf(state),
    versions: state.protocolVersion,
    active: state.activeProtocolVersion,
    synced: state.isSynced,
    coins: {
      shielded: state.shielded.totalCoins.length,
      unshielded: state.unshielded.totalCoins.length,
      dust: state.dust.totalCoins.length,
    },
    shieldedBalances: state.shielded.balances,
    unshieldedBalances: state.unshielded.balances,
    pending: state.pending.length,
  });

/** How a UTxO is named in both the wallet's state and a transaction's inputs. */
const utxoKey = (utxo: Readonly<{ intentHash: string; outputNo: number }>): string =>
  `${utxo.intentHash}#${utxo.outputNo}`;

/** Every unshielded input a finalized transaction spends, across all its intents and both offers. */
const unshieldedInputsOf = (transaction: ledger.FinalizedTransaction): readonly ledger.UtxoSpend[] =>
  Array.from(transaction.intents?.values() ?? []).flatMap((intent) => [
    ...(intent.guaranteedUnshieldedOffer?.inputs ?? []),
    ...(intent.fallibleUnshieldedOffer?.inputs ?? []),
  ]);

/**
 * A failure as the record needs it. Inspected rather than stringified: what a submission refusal is worth reading is
 * the reason the node gave, and that travels as a field of the wallet's error, which no `toString` reaches.
 */
const describeFailure = (error: unknown): string => inspect(error, { depth: 6, breakLength: 160 });

/** A deadline that says what was being waited for, rather than raising a bare `TimeoutError`. */
const failingAfter = <T>(label: string, milliseconds: number): rx.MonoTypeOperatorFunction<T> =>
  rx.timeout({
    first: milliseconds,
    with: () => rx.throwError(() => new Error(`Timed out after ${milliseconds}ms waiting for ${label}`)),
  });

/** Caps a wait that would otherwise only be bounded by the file's hour-long test timeout. */
const within = <T>(label: string, milliseconds: number, work: Promise<T>): Promise<T> =>
  rx.firstValueFrom(rx.from(work).pipe(failingAfter(label, milliseconds)));

/**
 * Whether a failure is the wallet saying it has not been given enough dust to pay for something.
 *
 * @remarks
 *   Matched by tag rather than by class: each wallet raises its own class under this tag on each side of the boundary, so
 *   `instanceof` would name one of six and treat the other five as something else. The failure arrives wrapped, because
 *   the facade's balancing runs on an Effect runtime.
 */
const isDustShortfall = (error: unknown): boolean => {
  const reported: unknown = Runtime.isFiberFailure(error)
    ? Option.getOrElse(Cause.failureOption(error[Runtime.FiberFailureCauseId]), () => error)
    : error;
  return (
    typeof reported === 'object' &&
    reported !== null &&
    '_tag' in reported &&
    reported._tag === 'Wallet.InsufficientFunds'
  );
};

/**
 * Builds a transaction once the wallet has accrued enough dust to pay for it.
 *
 * @param build The build to attempt, afresh each time.
 * @returns What `build` produced once it could be paid for.
 */
const onceEnoughDustHasBeenGenerated = <T>(build: () => Promise<T>): Promise<T> =>
  rx.firstValueFrom(
    rx.defer(build).pipe(
      rx.retry({
        delay: (error: unknown) =>
          isDustShortfall(error) ? rx.timer(DUST_POLL_MS) : rx.throwError(() => error as Error),
      }),
      failingAfter('enough dust to have been generated for a pre-fork transfer', DUST_TIMEOUT_MS),
    ),
  );

/** The first state satisfying `settled`, or a failure naming what never happened. */
const stateWhere = (
  label: string,
  wallet: WalletFacade,
  settled: (state: FacadeState) => boolean,
  milliseconds: number = SPEND_TIMEOUT_MS,
): Promise<FacadeState> =>
  rx.firstValueFrom(wallet.state().pipe(rx.filter(settled), failingAfter(label, milliseconds)));

/**
 * A wallet's states, each paired with the sequence of protocol phases observed up to it.
 *
 * @remarks
 *   Replayed and reference-counted off, so a later subscriber sees the phases that were observed before it arrived — a
 *   crossing that has already happened must still be readable by the test that asserts it.
 */
const trackPhases = (facade: WalletFacade): rx.Observable<Tracked> =>
  facade.state().pipe(
    rx.scan<FacadeState, Tracked>(
      (accumulated, state) => {
        const phase = phaseOf(state);
        return {
          state,
          phases: accumulated.phases.at(-1) === phase ? accumulated.phases : [...accumulated.phases, phase],
        };
      },
      { state: undefined, phases: [] },
    ),
    rx.shareReplay({ bufferSize: 1, refCount: false }),
  );

/**
 * The dust wallet the projections twin runs: the shipped two-variant composition, with the post-fork variant's
 * synchronization swapped for the projections fast sync.
 *
 * @remarks
 *   The one composition no other suite reaches. `projectionsBasedSync.undeployed.test.ts` exercises projections on a
 *   chain that is post-fork from its first block, so it can use a single-variant wallet and never crosses anything; the
 *   shipped `DustWallet` crosses but syncs by events on both sides. This one does both: the pre-fork variant reads the
 *   chain by event replay, hands its state to {@link Migration.makeCrossLedgerMigration}, and everything after the
 *   boundary is read by `makeEventLessSyncService` — which means a synced post-fork state _is_ the proof that the
 *   projections path ran on a migrated state.
 *
 *   No `chainVersionProbe` is configured, deliberately: this chain's genesis carries the pre-fork runtime, so the probe
 *   the shipped wallet defaults to would answer "pre-fork" and choose exactly the variant a wallet with no probe starts
 *   on. Leaving it out keeps the crossing this test is about the only thing being tested.
 */
const projectionsTwinDustWallet = (configuration: DefaultDustConfiguration) => {
  const dustParameters = configuration.dustParameters ?? ledger.LedgerParameters.initialParameters().dust;
  return CustomForkingDustWallet(
    configuration,
    {
      builder: new V1Builder().withDefaults(),
      // The one field that cannot be shared, exactly as the shipped composition handles it: `dustParameters` is a WASM
      // object of whichever ledger module produced it, so the pre-fork variant gets the pre-fork rebuild of the rates.
      configuration: { ...configuration, dustParameters: asPreForkDustParameters(dustParameters) },
    },
    {
      builder: new V2Builder()
        .withDefaults()
        .withSync(makeEventLessSyncService, makeEventLessSyncCapability)
        // Restated because `withSync` drops it: a sync service names the key material it is started with, so choosing
        // one un-chooses whatever derivation the previous choice had. This service is started with the same
        // `DustSecretKey` the default one is, and a two-variant wallet needs the derivation by name — it is how a
        // start from a seed answers for both sides of the boundary at once.
        .withStartAuxDefaults()
        .withMigration(() => Migration.makeCrossLedgerMigration({ dustParameters })),
      configuration,
    },
  );
};

const hasCrossed = (state: FacadeState | undefined): boolean =>
  state !== undefined &&
  state.protocol._tag === 'Settled' &&
  state.activeProtocolVersion >= ProtocolVersion.V9NativeForkVersion &&
  state.isSynced;

describe.sequential('Hard fork crossing @fork', () => {
  const getFixture = useForkFixture();

  let fixture: ForkFixture;
  let wallet: WalletFacade;
  let unshieldedKeystore: UnshieldedKeystore;
  let tracked: rx.Observable<Tracked>;
  let subscription: rx.Subscription;
  let preFork: FacadeState;
  let enactment: Awaited<ReturnType<ForkFixture['enactFork']>>;
  let postFork: FacadeState;
  let receiver: utils.WalletInit | undefined;
  let preForkReceiver: utils.WalletInit | undefined;
  let twin: utils.WalletInit;
  let twinTracked: rx.Observable<Tracked>;
  let twinSubscription: rx.Subscription;

  /**
   * Both wallets' dust holdings at one of the comparison points, so a failure has the numbers next to it.
   *
   * @remarks
   *   `progress.highestIndex` is logged with them because it is the cursor the projections sync resumes from, read as a
   *   block height. Only the projections path ever writes it, so the value the twin carries while it is still on the
   *   event path — the one at the pre-fork comparison — is exactly what the migration parks and hands to the first
   *   post-fork pass.
   */
  const logDustCounts = (label: string, eventsState: FacadeState, twinState: FacadeState): void => {
    logger.info(
      `${label} dust coins: events=${eventsState.dust.state.state.utxos.length}` +
        ` projections=${twinState.dust.state.state.utxos.length};` +
        ` seq events=[${eventsState.dust.state.state.utxos.map((utxo) => utxo.seq).join(',')}]` +
        ` projections=[${twinState.dust.state.state.utxos.map((utxo) => utxo.seq).join(',')}];` +
        ` highestIndex events=${eventsState.dust.state.progress.highestIndex}` +
        ` projections=${twinState.dust.state.progress.highestIndex}`,
    );
  };

  /** The twin, re-synced by hand: its post-fork sync hands over one snapshot and ends, rather than following the chain. */
  const resyncTwin = async (): Promise<FacadeState> => {
    await twin.wallet.doSync(twin.seeds);
    return await twin.wallet.waitForSyncedState();
  };

  beforeAll(async () => {
    fixture = getFixture();

    const seeds: WalletSeedsType = WalletSeeds.fromMasterSeed(Buffer.from(FUNDED_SEED, 'hex'));
    const configuration = {
      ...fixture.getWalletConfig(),
      ...fixture.getDustWalletConfig(),
      // Version-keyed proving wins over the fixture's single `provingServerUrl`, and names both epochs, because that
      // is what an application crossing the fork actually has to configure: no proof server serves both ledger
      // versions, so a wallet that spends on each side of the boundary needs one entry per side.
      provers: [
        {
          sinceVersion: ProtocolVersion.MinSupportedVersion,
          backend: { kind: 'server', url: new URL(fixture.getV8ProverUri()) },
        },
        {
          sinceVersion: ProtocolVersion.V9NativeForkVersion,
          backend: { kind: 'server', url: new URL(fixture.getProverUri()) },
        },
      ] as const satisfies DefaultConfiguration['provers'],
    };
    unshieldedKeystore = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, fixture.getNetworkId());

    wallet = await WalletFacade.init({
      configuration,
      shielded: (config) => ShieldedWallet(config).startWithSeed(seeds.shielded),
      unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
      dust: (config) => DustWallet(config).startWithSeed(seeds.dust),
    });
    await wallet.start(seeds);

    tracked = trackPhases(wallet);
    subscription = tracked
      .pipe(
        rx.map(({ state }) => (state === undefined ? '' : summarize(state))),
        rx.distinctUntilChanged(),
      )
      .subscribe((line) => logger.info(`STATE ${line}`));

    // Registered before the fork, on the same funded seed, so that it genuinely crosses: a twin attached afterwards
    // would start on the post-fork variant and prove nothing about the hand-over. It only reads — every transaction in
    // this file is built by the wallet above.
    twin = await utils.initWalletWithSeed(FUNDED_SEED, fixture, 'schnorr', {
      dustWallet: projectionsTwinDustWallet,
    });
    twinTracked = trackPhases(twin.wallet);
    twinSubscription = twinTracked
      .pipe(
        rx.map(({ state }) => (state === undefined ? '' : summarize(state))),
        rx.distinctUntilChanged(),
      )
      .subscribe((line) => logger.info(`TWIN STATE ${line}`));
  }, 300_000);

  afterAll(async () => {
    subscription?.unsubscribe();
    twinSubscription?.unsubscribe();
    await wallet?.stop();
    await twin?.wallet.stop();
    await receiver?.wallet.stop();
    await preForkReceiver?.wallet.stop();
  }, 60_000);

  test('syncs to the pre-fork tip on the old ledger', async () => {
    preFork = await wallet.waitForSyncedState();
    logger.info(`PRE-FORK SYNCED ${summarize(preFork)}`);

    expect(preFork.protocol._tag).toBe('Settled');
    expect(preFork.activeProtocolVersion).toBeLessThan(ProtocolVersion.V9NativeForkVersion);

    const specVersion = await fixture.specVersionAtHead();
    expect(specVersion).toBe(PRE_FORK_SPEC_VERSION);

    expect(preFork.unshielded.balances[NIGHT]).toBeGreaterThan(0n);
    expect(Object.keys(preFork.shielded.balances).length).toBeGreaterThan(0);
  });

  test(
    'the projections twin holds the same dust on the pre-fork chain',
    async () => {
      // Both wallets read the chain by event replay here — the twin's projections sync belongs to its post-fork
      // variant, which no chain below the boundary activates. This is the baseline the later comparisons move from:
      // whatever the two disagree about after the fork cannot be blamed on them having started out apart.
      const twinState = await within(
        'the projections twin to sync to the pre-fork tip',
        CROSSING_TIMEOUT_MS,
        twin.wallet.waitForSyncedState(),
      );
      const eventsState = await wallet.waitForSyncedState();
      logDustCounts('A pre-fork', eventsState, twinState);
      logger.info(
        'A the cursor the twin will carry across the fork, and the one its first projections pass will resume from:' +
          ` ${twinState.dust.state.progress.highestIndex}`,
      );

      expect(twinState.protocolVersion.dust).toBeLessThan(ProtocolVersion.V9NativeForkVersion);
      expect(sameDustCoins(eventsState.dust.state.state, twinState.dust.state.state)).toBe(true);
      expect(rootsEqual(eventsState.dust.state.state, twinState.dust.state.state)).toBe(true);
    },
    CROSSING_TIMEOUT_MS,
  );

  test(
    'spends before the fork, proving at the ledger-v8 proof server',
    async () => {
      // The half of proving no other lane can reach. Below the boundary the wallet builds ledger-v8 bytes, and only the
      // ledger-v8 can frame a proving request for them and only a ledger-v8 proof server can answer it — so what
      // this proves is that the version-keyed backends were honoured, not merely accepted by configuration. The same
      // wallet proves at the other server after the fork, which is the acceptance criterion for the pair.
      preForkReceiver = await utils.initWalletWithSeed(V8_RECEIVER_SEED, fixture);
      const receiverBefore = await within(
        'the pre-fork receiver to sync',
        CROSSING_TIMEOUT_MS,
        preForkReceiver.wallet.waitForSyncedState(),
      );
      expect(receiverBefore.unshielded.balances[NIGHT] ?? 0n).toBe(0n);

      const before = await wallet.waitForSyncedState();
      expect(before.activeProtocolVersion).toBeLessThan(ProtocolVersion.V9NativeForkVersion);
      const nightBefore = before.unshielded.balances[NIGHT];

      // Dust accrues with time, and this chain is seconds old: for the first half-minute of it there is not enough for
      // the wallet to pay for anything, and it says so by refusing to balance. What a transfer costs cannot be asked
      // before there is a transfer to price, so "enough has accrued" is expressed as the build succeeding, retried
      // until it does. That the wallet leaves the inputs of a build it could not pay for booked is why the first
      // attempts cost it coins it does not get back — enough of them remain for the one that succeeds.
      const receiverAddress = await preForkReceiver.wallet.unshielded.getAddress();
      const recipe = await onceEnoughDustHasBeenGenerated(() =>
        wallet.transferTransaction(
          [{ type: 'unshielded', outputs: [{ type: NIGHT, amount: TRANSFER_AMOUNT, receiverAddress }] }],
          { ttl: new Date(Date.now() + TTL_MS) },
        ),
      );
      const signed = await wallet.signRecipe(recipe, unshieldedKeystore.signDataAsync);
      const finalizedTx = await wallet.finalizeRecipe(signed);

      // The proof came back as ledger-v8's transaction, which is only true if the ledger-v8 backend produced
      // it: ledger-v9's classes are a different type and would have been unwrapped as one.
      expect(carried<preForkLedger.FinalizedTransaction>(finalizedTx)).toBeInstanceOf(preForkLedger.Transaction);

      const txId = await wallet.submitTransaction(finalizedTx);
      logger.info(`pre-fork unshielded transfer submitted: ${txId}`);

      // The receiver's arrival, not the sender's bookkeeping, is what says the chain took the transaction: the sender
      // books a spend the moment it submits one, and the coins the earlier attempts booked make its own balances a
      // poor witness. An empty account seeing exactly what was sent to it is decided by inclusion and nothing else.
      const receiverAfter = await stateWhere(
        'the pre-fork receiver to see the transferred Night',
        preForkReceiver.wallet,
        (state) => state.isSynced && (state.unshielded.balances[NIGHT] ?? 0n) > 0n,
      );
      logger.info(`AFTER PRE-FORK SPEND ${summarize(receiverAfter)}`);
      expect(receiverAfter.unshielded.balances[NIGHT]).toBe(TRANSFER_AMOUNT);
      expect(nightBefore).toBe(preFork.unshielded.balances[NIGHT]);
    },
    SPEND_TIMEOUT_MS + 5 * 60 * 1000,
  );

  test('enacts the ledger 8 to 9 hard fork through governance', async () => {
    enactment = await fixture.enactFork();
    logger.info(`FORK ENACTED ${JSON.stringify(enactment)}`);

    expect(enactment.newSpecVersion).toBeGreaterThan(enactment.oldSpecVersion);
    expect(enactment.appliedAt).toBeGreaterThan(1);
  });

  test('crosses the boundary and settles on the post-fork variants', async () => {
    const observed = await rx.firstValueFrom(
      tracked.pipe(
        rx.filter(({ state }) => hasCrossed(state)),
        rx.take(1),
        rx.timeout({ first: CROSSING_TIMEOUT_MS }),
      ),
    );
    postFork = observed.state!;
    logger.info(`POST-FORK SETTLED ${summarize(postFork)}`);
    logger.info(`phase transitions observed: ${observed.phases.join('  ->  ')}`);

    expect(postFork.protocol._tag).toBe('Settled');
    expect(postFork.activeProtocolVersion).toBeGreaterThanOrEqual(ProtocolVersion.V9NativeForkVersion);
    expect(postFork.isSynced).toBe(true);

    // The wallets do not cross together: each learns of the change when its own synchronization
    // reaches it, so the facade must report at least one window in which they disagreed.
    const firstCrossing = observed.phases.findIndex((phase) => phase.startsWith('Crossing'));
    expect(firstCrossing).toBeGreaterThanOrEqual(0);
    expect(firstCrossing).toBeLessThan(observed.phases.length - 1);
    expect(observed.phases.at(-1)).toBe(phaseOf(postFork));
  });

  test(
    'the projections twin crosses onto the projections sync',
    async () => {
      const observed = await rx.firstValueFrom(
        twinTracked.pipe(
          rx.filter(({ state }) => hasCrossed(state)),
          rx.take(1),
          rx.timeout({ first: CROSSING_TIMEOUT_MS }),
        ),
      );
      const twinState = observed.state!;
      const eventsState = await wallet.waitForSyncedState();
      logger.info(`TWIN POST-FORK SETTLED ${summarize(twinState)}`);
      logger.info(`twin phase transitions observed: ${observed.phases.join('  ->  ')}`);
      logDustCounts('B post-fork', eventsState, twinState);

      expect(twinState.protocol._tag).toBe('Settled');
      expect(twinState.activeProtocolVersion).toBeGreaterThanOrEqual(ProtocolVersion.V9NativeForkVersion);
      expect(twinState.isSynced).toBe(true);
      // The twin's post-fork variant has exactly one synchronization — the projections one — so a settled post-fork
      // state is itself the proof that the projections path ran, and ran on a state produced by the migration.
      expect(sameDustCoins(eventsState.dust.state.state, twinState.dust.state.state)).toBe(true);
    },
    CROSSING_TIMEOUT_MS + 60_000,
  );

  test('carries its balances across the boundary', () => {
    logger.info(
      `INFO dust: pre coins=${preFork.dust.totalCoins.length} balance=${preFork.dust.balance(new Date())};` +
        ` post coins=${postFork.dust.totalCoins.length} balance=${postFork.dust.balance(new Date())}`,
    );

    // Everything the wallet had at the pre-fork tip, less the one transfer it made below the boundary — which is the
    // only Night that legitimately left it there, and is stated rather than read back from the wallet so that what
    // crossed is compared against what the chain was asked for.
    expect(postFork.unshielded.balances).toEqual({
      ...preFork.unshielded.balances,
      [NIGHT]: preFork.unshielded.balances[NIGHT] - TRANSFER_AMOUNT,
    });
    expect(postFork.shielded.balances).toEqual(preFork.shielded.balances);
    expect(postFork.pending.length).toBe(0);
  });

  test('restores a post-fork snapshot on the version it declares', async () => {
    const snapshot = await wallet.shielded.serializeState();
    const restored = ShieldedWallet(fixture.getWalletConfig()).tryRestore(snapshot);

    expect(Either.isRight(restored)).toBe(true);
    if (Either.isRight(restored)) {
      await restored.right.stop();
    }
  });

  test(
    're-registers its NIGHT for dust generation after the fork',
    async () => {
      const before = await wallet.waitForSyncedState();
      logger.info(
        `POST-FORK DUST before re-registration: available=${before.dust.availableCoins.length}` +
          ` total=${before.dust.totalCoins.length} balance=${before.dust.balance(new Date())}`,
      );
      logger.info(
        `POST-FORK unshielded coins: ${asJson(
          before.unshielded.availableCoins.map(({ utxo, meta }) => ({
            utxo: utxoKey(utxo),
            value: utxo.value,
            type: utxo.type,
            ctime: meta.ctime,
            registeredForDustGeneration: meta.registeredForDustGeneration,
          })),
        )}`,
      );

      const nightUtxos = before.unshielded.availableCoins.filter((coin) => coin.utxo.type === ledger.nativeToken().raw);
      expect(nightUtxos.length).toBeGreaterThan(0);

      const { fee } = await wallet.estimateRegistration(nightUtxos);
      logger.info(`registration fee estimate: ${fee}`);
      // A first-time registration pays its own fee out of the dust its still-unregistered Night has accrued, so
      // wait for that much (`designation.ts`). Night the chain already calls registered has no such allowance —
      // there is nothing to wait for, and waiting would only mean waiting forever.
      const unregistered = nightUtxos.filter(({ meta }) => !meta.registeredForDustGeneration);
      if (unregistered.length > 0) {
        await wallet.waitForGeneratedDust(nightUtxos, fee, { timeoutMs: DUST_TIMEOUT_MS });
      } else {
        logger.info(
          'every Night UTxO still reports registeredForDustGeneration=true after the fork, so the registration' +
            ' has no generation allowance to draw its own fee from; submitting it as a re-registration',
        );
      }

      const recipe = await wallet.registerNightUtxosForDustGeneration(
        nightUtxos,
        unshieldedKeystore.getPublicKey(),
        unshieldedKeystore.signDataAsync,
      );
      const finalizedTx = await wallet.finalizeRecipe(recipe);
      const txId = await wallet.submitTransaction(finalizedTx).catch((error: unknown) => {
        // A refusal by the node says why in the error's cause, which the runner prints nothing of; the same
        // reason is in `reports/fork-logs/node.log`, but only if someone thinks to look there.
        logger.error(`registration submission refused: ${describeFailure(error)}`);
        throw error;
      });
      logger.info(`registration transaction submitted: ${txId}`);
      expect(txId).toBeTypeOf('string');

      const registrationHash = carried<ledger.FinalizedTransaction>(finalizedTx).transactionHash();
      await within(
        'the re-registration to be finalized',
        DUST_TIMEOUT_MS,
        utils.waitForTxInHistory(registrationHash, wallet),
      );
      const registered = await stateWhere(
        'the re-registered Night to generate dust',
        wallet,
        (state) => state.isSynced && state.dust.availableCoins.length > 0,
        DUST_TIMEOUT_MS,
      );
      logger.info(`POST-REGISTRATION ${summarize(registered)}`);
      logger.info(
        `POST-REGISTRATION dust: available=${registered.dust.availableCoins.length}` +
          ` balance=${registered.dust.balance(new Date())}`,
      );

      expect(registered.dust.balance(new Date())).toBeGreaterThan(0n);
      expect(registered.unshielded.balances[NIGHT]).toBe(postFork.unshielded.balances[NIGHT]);
    },
    15 * 60 * 1000,
  );

  test(
    'the projections twin sees the post-fork re-registration',
    async () => {
      // The first projections pass on a migrated state that has something to find. The registration is post-fork, so
      // nothing the pre-fork variant ever applied accounts for this dust — the twin can only be holding it because the
      // projections path fetched it, resuming from whatever cursor the migration parked.
      const eventsState = await wallet.waitForSyncedState();
      const twinState = await within('the projections twin to re-sync', DUST_TIMEOUT_MS, resyncTwin());
      logDustCounts('C after the re-registration', eventsState, twinState);

      const now = new Date();
      logger.info(
        `C dust balances: events=${eventsState.dust.balance(now)} projections=${twinState.dust.balance(now)}`,
      );

      expect(eventsState.dust.state.state.utxos.length).toBeGreaterThan(0);
      expect(sameDustCoins(eventsState.dust.state.state, twinState.dust.state.state)).toBe(true);
      expect(rootsEqual(eventsState.dust.state.state, twinState.dust.state.state)).toBe(true);
      expect(twinState.dust.balance(now)).toBe(eventsState.dust.balance(now));
    },
    DUST_TIMEOUT_MS + 60_000,
  );

  test(
    'spends a carried unshielded coin after the fork',
    async () => {
      receiver = await utils.initWalletWithSeed(RECEIVER_SEED, fixture);
      const receiverBefore = await within(
        'the receiver to sync across the boundary',
        CROSSING_TIMEOUT_MS,
        receiver.wallet.waitForSyncedState(),
      );
      expect(receiverBefore.unshielded.balances[NIGHT] ?? 0n).toBe(0n);

      const before = await wallet.waitForSyncedState();
      const nightBefore = before.unshielded.balances[NIGHT];
      const dustBefore = before.dust.balance(new Date());
      const carriedUtxos = new Set(preFork.unshielded.availableCoins.map(({ utxo }) => utxoKey(utxo)));

      const recipe = await wallet.transferTransaction(
        [
          {
            type: 'unshielded',
            outputs: [
              {
                type: ledger.nativeToken().raw,
                amount: TRANSFER_AMOUNT,
                receiverAddress: await receiver.wallet.unshielded.getAddress(),
              },
            ],
          },
        ],
        { ttl: new Date(Date.now() + TTL_MS) },
      );
      const signed = await wallet.signRecipe(recipe, unshieldedKeystore.signDataAsync);
      const finalizedTx = await wallet.finalizeRecipe(signed);

      const inputs = unshieldedInputsOf(carried<ledger.FinalizedTransaction>(finalizedTx));
      logger.info(
        `UNSHIELDED SPEND inputs: ${asJson(
          inputs.map((input) => ({
            utxo: utxoKey(input),
            value: input.value,
            type: input.type,
            carriedAcrossTheFork: carriedUtxos.has(utxoKey(input)),
          })),
        )}`,
      );

      const txId = await wallet.submitTransaction(finalizedTx);
      logger.info(`unshielded transfer submitted: ${txId}`);
      expect(txId).toBeTypeOf('string');

      const txHash = carried<ledger.FinalizedTransaction>(finalizedTx).transactionHash();
      const senderEntry = await within(
        'the unshielded spend to be finalized for the sender',
        SPEND_TIMEOUT_MS,
        utils.waitForTxInHistory(txHash, wallet, { ready: (entry: WalletEntry) => entry.unshielded !== undefined }),
      );
      utils.expectSenderUnshieldedTxHistory(senderEntry);

      const afterUnshieldedSpend = await stateWhere(
        'the sender to settle after the unshielded spend',
        wallet,
        (state) =>
          state.isSynced &&
          state.unshielded.pendingCoins.length === 0 &&
          state.pending.length === 0 &&
          state.unshielded.balances[NIGHT] !== nightBefore,
      );
      logger.info(`AFTER UNSHIELDED SPEND ${summarize(afterUnshieldedSpend)}`);
      logger.info(`dust fees paid: ${dustBefore - afterUnshieldedSpend.dust.balance(new Date())}`);

      // Fees are dust, so the Night that left the wallet is exactly what was transferred.
      expect(afterUnshieldedSpend.unshielded.balances[NIGHT]).toBe(nightBefore - TRANSFER_AMOUNT);
      expect(afterUnshieldedSpend.unshielded.pendingCoins.length).toBe(0);
      expect(afterUnshieldedSpend.pending.length).toBe(0);

      const receiverAfter = await stateWhere(
        'the receiver to see the transferred Night',
        receiver.wallet,
        (state) => state.isSynced && (state.unshielded.balances[NIGHT] ?? 0n) > 0n,
      );
      expect(receiverAfter.unshielded.balances[NIGHT]).toBe(TRANSFER_AMOUNT);
    },
    20 * 60 * 1000,
  );

  test(
    'spends a carried shielded coin after the fork',
    async () => {
      const shieldedToken = ledger.shieldedToken().raw;
      const before = await wallet.waitForSyncedState();
      const shieldedBefore = before.shielded.balances[shieldedToken];
      const dustBefore = before.dust.balance(new Date());
      const carriedNonces = new Set(preFork.shielded.availableCoins.map(({ coin }) => coin.nonce));
      expect(shieldedBefore).toBeGreaterThan(TRANSFER_AMOUNT);

      const receiverWallet = receiver!.wallet;
      const receiverBefore = await receiverWallet.waitForSyncedState();
      expect(receiverBefore.shielded.balances[shieldedToken] ?? 0n).toBe(0n);

      const recipe = await wallet.transferTransaction(
        [
          {
            type: 'shielded',
            outputs: [
              {
                type: shieldedToken,
                amount: TRANSFER_AMOUNT,
                receiverAddress: await receiverWallet.shielded.getAddress(),
              },
            ],
          },
        ],
        { ttl: new Date(Date.now() + TTL_MS) },
      );
      const signed = await wallet.signRecipe(recipe, unshieldedKeystore.signDataAsync);
      const finalizedTx = await wallet.finalizeRecipe(signed);

      const txId = await wallet.submitTransaction(finalizedTx);
      logger.info(`shielded transfer submitted: ${txId}`);
      expect(txId).toBeTypeOf('string');

      const txHash = carried<ledger.FinalizedTransaction>(finalizedTx).transactionHash();
      const senderEntry = await within(
        'the shielded spend to be finalized for the sender',
        SPEND_TIMEOUT_MS,
        utils.waitForTxInHistory(txHash, wallet, { ready: (entry: WalletEntry) => entry.shielded !== undefined }),
      );
      utils.expectSenderShieldedTxHistory(senderEntry);
      // The coins this spend consumed, and whether each one is one of those the wallet carried across as bytes.
      logger.info(
        `SHIELDED SPEND inputs: ${asJson(
          senderEntry.shielded!.spentCoins.map((coin) => ({
            nonce: coin.nonce,
            value: coin.value,
            type: coin.type,
            carriedAcrossTheFork: carriedNonces.has(coin.nonce),
          })),
        )}`,
      );

      const afterShieldedSpend = await stateWhere(
        'the sender to settle after the shielded spend',
        wallet,
        (state) =>
          state.isSynced &&
          state.shielded.pendingCoins.length === 0 &&
          state.pending.length === 0 &&
          state.shielded.balances[shieldedToken] !== shieldedBefore,
      );
      logger.info(`AFTER SHIELDED SPEND ${summarize(afterShieldedSpend)}`);
      logger.info(`dust fees paid: ${dustBefore - afterShieldedSpend.dust.balance(new Date())}`);

      expect(afterShieldedSpend.shielded.balances[shieldedToken]).toBe(shieldedBefore - TRANSFER_AMOUNT);
      expect(afterShieldedSpend.shielded.pendingCoins.length).toBe(0);
      expect(afterShieldedSpend.pending.length).toBe(0);

      const receiverAfter = await stateWhere(
        'the receiver to see the transferred shielded token',
        receiverWallet,
        (state) => state.isSynced && (state.shielded.balances[shieldedToken] ?? 0n) > 0n,
      );
      expect(receiverAfter.shielded.balances[shieldedToken]).toBe(TRANSFER_AMOUNT);
    },
    20 * 60 * 1000,
  );

  test(
    'the projections twin sees the dust the post-fork spends paid with',
    async () => {
      // Both spends paid their fee in dust, so each consumed a dust UTxO and left its successor behind. A projections
      // pass reads that as a snapshot rather than as a spend event, and has to arrive at the same holdings.
      const eventsState = await wallet.waitForSyncedState();
      const twinState = await within('the projections twin to re-sync', DUST_TIMEOUT_MS, resyncTwin());
      logDustCounts('D after the two spends', eventsState, twinState);

      const now = new Date();
      logger.info(
        `D dust balances: events=${eventsState.dust.balance(now)} projections=${twinState.dust.balance(now)}`,
      );

      expect(eventsState.dust.state.state.utxos.length).toBeGreaterThan(0);
      expect(sameDustCoins(eventsState.dust.state.state, twinState.dust.state.state)).toBe(true);
      expect(rootsEqual(eventsState.dust.state.state, twinState.dust.state.state)).toBe(true);
      expect(twinState.dust.balance(now)).toBe(eventsState.dust.balance(now));
    },
    DUST_TIMEOUT_MS + 60_000,
  );
});
