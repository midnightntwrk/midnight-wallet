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
import { Either } from 'effect';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
// The post-fork ledger, and the only one these tests author at: everything from `re-registers its NIGHT`
// onwards is built after the boundary, so a v9 token constant is the right way to name what is moved.
import * as ledger from '@midnightntwrk/ledger-v9';
import { type WalletSeeds as WalletSeedsType, WalletSeeds } from '@midnightntwrk/wallet-sdk-hd';
import { ShieldedWallet, V9_NATIVE_FORK_VERSION } from '@midnightntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  PublicKey,
  type UnshieldedKeystore,
  UnshieldedWallet,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { type FacadeState, type WalletEntry, WalletFacade } from '@midnightntwrk/wallet-sdk-facade';
import { type ForkFixture, useForkFixture } from './fork-fixture.js';
import * as utils from './utils.js';
import { carried } from './helpers/transactions.js';
import { logger } from './logger.js';

/** The dev preset's funded account. */
const FUNDED_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/** An account with nothing on it, which is what makes the post-fork spends' arrival assertions exact. */
const RECEIVER_SEED = 'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82';

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

/** The first state satisfying `settled`, or a failure naming what never happened. */
const stateWhere = (
  label: string,
  wallet: WalletFacade,
  settled: (state: FacadeState) => boolean,
  milliseconds: number = SPEND_TIMEOUT_MS,
): Promise<FacadeState> =>
  rx.firstValueFrom(wallet.state().pipe(rx.filter(settled), failingAfter(label, milliseconds)));

const hasCrossed = (state: FacadeState | undefined): boolean =>
  state !== undefined &&
  state.protocol._tag === 'Settled' &&
  state.activeProtocolVersion >= V9_NATIVE_FORK_VERSION &&
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

  beforeAll(async () => {
    fixture = getFixture();

    const seeds: WalletSeedsType = WalletSeeds.fromMasterSeed(Buffer.from(FUNDED_SEED, 'hex'));
    const configuration = {
      ...fixture.getWalletConfig(),
      ...fixture.getDustWalletConfig(),
      // Version-keyed proving wins over the fixture's single `provingServerUrl`; named here so the
      // wallet's post-fork proving routes exactly as an application crossing the fork would set it up.
      provingServers: [{ sinceVersion: V9_NATIVE_FORK_VERSION, url: new URL(fixture.getProverUri()) }],
    };
    unshieldedKeystore = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, fixture.getNetworkId());

    wallet = await WalletFacade.init({
      configuration,
      shielded: (config) => ShieldedWallet(config).startWithSeed(seeds.shielded),
      unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
      dust: (config) => DustWallet(config).startWithSeed(seeds.dust),
    });
    await wallet.start(seeds);

    tracked = wallet.state().pipe(
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
    subscription = tracked
      .pipe(
        rx.map(({ state }) => (state === undefined ? '' : summarize(state))),
        rx.distinctUntilChanged(),
      )
      .subscribe((line) => logger.info(`STATE ${line}`));
  }, 300_000);

  afterAll(async () => {
    subscription?.unsubscribe();
    await wallet?.stop();
    await receiver?.wallet.stop();
  }, 60_000);

  test('syncs to the pre-fork tip on the old ledger', async () => {
    preFork = await wallet.waitForSyncedState();
    logger.info(`PRE-FORK SYNCED ${summarize(preFork)}`);

    expect(preFork.protocol._tag).toBe('Settled');
    expect(preFork.activeProtocolVersion).toBeLessThan(V9_NATIVE_FORK_VERSION);

    const specVersion = await fixture.specVersionAtHead();
    expect(specVersion).toBe(PRE_FORK_SPEC_VERSION);

    expect(preFork.unshielded.balances[NIGHT]).toBeGreaterThan(0n);
    expect(Object.keys(preFork.shielded.balances).length).toBeGreaterThan(0);
  });

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
    expect(postFork.activeProtocolVersion).toBeGreaterThanOrEqual(V9_NATIVE_FORK_VERSION);
    expect(postFork.isSynced).toBe(true);

    // The wallets do not cross together: each learns of the change when its own synchronization
    // reaches it, so the facade must report at least one window in which they disagreed.
    const firstCrossing = observed.phases.findIndex((phase) => phase.startsWith('Crossing'));
    expect(firstCrossing).toBeGreaterThanOrEqual(0);
    expect(firstCrossing).toBeLessThan(observed.phases.length - 1);
    expect(observed.phases.at(-1)).toBe(phaseOf(postFork));
  });

  test('carries its balances across the boundary', () => {
    logger.info(
      `INFO dust: pre coins=${preFork.dust.totalCoins.length} balance=${preFork.dust.balance(new Date())};` +
        ` post coins=${postFork.dust.totalCoins.length} balance=${postFork.dust.balance(new Date())}`,
    );

    expect(postFork.unshielded.balances).toEqual(preFork.unshielded.balances);
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
});
