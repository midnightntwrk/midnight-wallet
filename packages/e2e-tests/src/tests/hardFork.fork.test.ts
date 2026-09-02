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
// The hard-fork drill, as a test. One facade wallet syncs a chain whose genesis carries the
// pre-fork (ledger 8) runtime, the fork is enacted through governance while it watches, and the
// wallet has to cross to its post-fork variants with the same money it had before.
//
// This is the automated form of `.context/hardfork-drill/wallet-drill.mjs` plus the chain-level
// checks the drill's `hardfork.sh verify` made. It is its own vitest project (`fork`) rather than
// an `*.undeployed.test.ts`, because it needs a different stack and must never be retried: a retry
// would re-run against an already-forked chain and fail for an unrelated reason.
import * as rx from 'rxjs';
import { Buffer } from 'node:buffer';
import { Either } from 'effect';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { type WalletSeeds as WalletSeedsType, WalletSeeds } from '@midnightntwrk/wallet-sdk-hd';
import { ShieldedWallet, V9_NATIVE_FORK_VERSION } from '@midnightntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { type FacadeState, WalletFacade } from '@midnightntwrk/wallet-sdk-facade';
import { type ForkFixture, useForkFixture } from './fork-fixture.js';
import { logger } from './logger.js';

/** The dev preset's funded account — the same master seed the manual drill runs on. */
const FUNDED_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/**
 * Native NIGHT. Written out rather than read from a ledger binding on purpose: the wallet holds this balance on both
 * sides of the boundary, so the assertion must not be phrased in either ledger's terms.
 */
const NIGHT = '0000000000000000000000000000000000000000000000000000000000000000';

/** The spec version the `1.0.1` runtime reports, and therefore what genesis must be carrying. */
const PRE_FORK_SPEC_VERSION = 1_000_000;

/** How long the wallet is given to notice the fork, migrate all three sub-wallets, and re-sync. */
const CROSSING_TIMEOUT_MS = 8 * 60 * 1000;

/** A state reading together with the phase sequence observed up to it. */
type Tracked = Readonly<{ state: FacadeState | undefined; phases: readonly string[] }>;

const phaseOf = (state: FacadeState): string =>
  state.protocol._tag === 'Settled'
    ? `Settled@${state.protocol.version}`
    : `Crossing ${state.protocol.from}->${state.protocol.to} behind=[${state.protocol.behind.join(',')}]`;

const summarize = (state: FacadeState): string =>
  JSON.stringify(
    {
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
    },
    (_key, value: unknown) => (typeof value === 'bigint' ? `${value}n` : value),
  );

const hasCrossed = (state: FacadeState | undefined): boolean =>
  state !== undefined &&
  state.protocol._tag === 'Settled' &&
  state.activeProtocolVersion >= V9_NATIVE_FORK_VERSION &&
  state.isSynced;

describe.sequential('Hard fork drill @fork', () => {
  const getFixture = useForkFixture();

  let fixture: ForkFixture;
  let wallet: WalletFacade;
  let tracked: rx.Observable<Tracked>;
  let subscription: rx.Subscription;
  let preFork: FacadeState;
  let enactment: Awaited<ReturnType<ForkFixture['enactFork']>>;
  let postFork: FacadeState;

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
    const unshieldedKeystore = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, fixture.getNetworkId());

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
});
