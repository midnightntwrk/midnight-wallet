/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * What the facade makes of three wallets that disagree about which side of the protocol boundary the chain is on.
 *
 * @remarks
 *   `protocolPhase.test.ts` pins `protocolPhaseOf` itself, over versions handed to it directly. This is the other half:
 *   that the three wallets' own state streams reach it, each in its own slot, and that the answer follows them as they
 *   cross. `orphanOnFork.test.ts` reads `protocol` too, but only of three wallets that have never synchronized — which
 *   is the `Settled` arm and cannot be anything else.
 *
 *   Real disagreement is manufactured rather than simulated. Driving three wallets across a real fork means three
 *   simulated chains, a replay and a cross-ledger migration inside one facade suite, which proves the wallets rather
 *   than the wiring. What is under test here is a `combineLatest` and three property reads, so the three states are the
 *   wallets' own — taken from real, shipped, unstarted wallets — restated at the versions a crossing would put them
 *   at.
 *
 *   The versions are deliberately all different where they can be, so a wiring that read one wallet's version three
 *   times, or paired the wrong wallet with the wrong slot, fails rather than coincidentally passes.
 */

import * as ledger from '@midnightntwrk/ledger-v9';
import {
  InMemoryTransactionHistoryStorage,
  NetworkId,
  ProtocolVersion,
  type FinalizedTx,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import type { PendingTransactionsService } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import { DustWallet, type DustWalletState } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet, type ShieldedWalletState } from '@midnightntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedWalletState,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { Option } from 'effect';
import * as rx from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DefaultConfiguration, WalletEntrySchema, WalletFacade, mergeWalletEntries } from '../src/index.js';

import {
  createPreForkMockProvingService,
  drivenBy,
  dustAt,
  getDustSeed,
  getShieldedSeed,
  getUnshieldedSeed,
  shieldedAt,
  unshieldedAt,
} from './utils/index.js';

/** The boundary the facade reads `protocol` against. */
const forkVersion = ProtocolVersion.V9NativeForkVersion;

/** Three versions below the boundary, all different: ordinary drift within one epoch. */
const beforeFork = {
  shielded: ProtocolVersion.ProtocolVersion(3n),
  unshielded: ProtocolVersion.ProtocolVersion(1n),
  dust: ProtocolVersion.ProtocolVersion(2n),
} as const;

/** Two versions at or past it, different again: a wallet that has crossed need not be at the boundary exactly. */
const afterFork = {
  shielded: ProtocolVersion.ProtocolVersion(forkVersion + 5n),
  dust: forkVersion,
} as const;

/** A pending service that answers and records, so the facade's own orphaning subscription has somewhere to go. */
class SilentPendingTransactions implements PendingTransactionsService<FinalizedTx> {
  readonly states = new rx.BehaviorSubject<PendingTransactions.PendingTransactions<FinalizedTx>>(
    PendingTransactions.empty(),
  );

  start(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  state(): rx.Observable<PendingTransactions.PendingTransactions<FinalizedTx>> {
    return this.states.asObservable();
  }

  addPendingTransaction(): Promise<void> {
    return Promise.resolve();
  }

  clear(): Promise<void> {
    return Promise.resolve();
  }

  orphanBeyond(): Promise<void> {
    return Promise.resolve();
  }
}

describe('three wallets that disagree about which side of the boundary the chain is on', () => {
  let facade: WalletFacade;
  let shieldedStates: rx.BehaviorSubject<ShieldedWalletState>;
  let unshieldedStates: rx.BehaviorSubject<UnshieldedWalletState>;
  let dustStates: rx.BehaviorSubject<DustWalletState>;

  beforeEach(async () => {
    const configuration: DefaultConfiguration = {
      networkId: NetworkId.NetworkId.Undeployed,
      forks: { v9: forkVersion },
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: { feeBlocksMargin: 0 },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    };
    const seed = '0000000000000000000000000000000000000000000000000000000000000002';
    const keystore = createKeystore({ kind: 'schnorr', secret: getUnshieldedSeed(seed) }, configuration.networkId);

    // Real, shipped wallets, deliberately never started: this suite supplies their state stream, and starting them
    // would open indexer subscriptions it has no indexer for.
    const shielded = await ShieldedWallet(configuration).startWithSeed(getShieldedSeed(seed));
    const unshielded = await UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(keystore));
    const dust = await DustWallet(configuration).startWithSeed(
      getDustSeed(seed),
      ledger.LedgerParameters.initialParameters().dust,
    );

    shieldedStates = new rx.BehaviorSubject(shieldedAt(await rx.firstValueFrom(shielded.state), beforeFork.shielded));
    unshieldedStates = new rx.BehaviorSubject(
      unshieldedAt(await rx.firstValueFrom(unshielded.state), beforeFork.unshielded),
    );
    dustStates = new rx.BehaviorSubject(dustAt(await rx.firstValueFrom(dust.state), beforeFork.dust));

    drivenBy(shielded, shieldedStates);
    drivenBy(unshielded, unshieldedStates);
    drivenBy(dust, dustStates);

    facade = await WalletFacade.init({
      configuration,
      shielded: () => shielded,
      unshielded: () => unshielded,
      dust: () => dust,
      provingService: () => createPreForkMockProvingService(),
      pendingTransactionsService: () => new SilentPendingTransactions(),
    });
  });

  afterEach(async () => {
    await facade?.stop();
  });

  it('reports each wallet in its own slot, and calls a chain none of them has left settled', async () => {
    const observed = await rx.firstValueFrom(facade.state());

    // Three different versions, so a wiring that read one wallet three times cannot pass this.
    expect(observed.protocolVersion).toStrictEqual(beforeFork);
    expect(observed.activeProtocolVersion).toBe(beforeFork.unshielded);
    // Differing versions within one epoch are ordinary synchronization, not a crossing.
    expect(observed.protocol).toStrictEqual({ _tag: 'Settled', version: beforeFork.unshielded });
  });

  it('calls the chain crossing while one wallet is still on the near side, and names it', async () => {
    shieldedStates.next(shieldedAt(shieldedStates.value, afterFork.shielded));
    dustStates.next(dustAt(dustStates.value, afterFork.dust));

    const observed = await rx.firstValueFrom(facade.state());

    expect(observed.protocol).toStrictEqual({
      _tag: 'Crossing',
      from: beforeFork.unshielded,
      to: afterFork.shielded,
      behind: ['unshielded'],
    });
    // What the facade stays bound to meanwhile is what it acts at: the wallet still behind bounds all three.
    expect(observed.activeProtocolVersion).toBe(beforeFork.unshielded);
  });

  it('names every wallet still on the near side, in a fixed order', async () => {
    shieldedStates.next(shieldedAt(shieldedStates.value, afterFork.shielded));

    const observed = await rx.firstValueFrom(facade.state());

    expect(observed.protocol).toStrictEqual({
      _tag: 'Crossing',
      from: beforeFork.unshielded,
      to: afterFork.shielded,
      behind: ['unshielded', 'dust'],
    });
  });

  it('settles again once the last wallet has crossed, at the version they all now report', async () => {
    shieldedStates.next(shieldedAt(shieldedStates.value, afterFork.shielded));
    dustStates.next(dustAt(dustStates.value, afterFork.dust));
    expect((await rx.firstValueFrom(facade.state())).protocol._tag).toBe('Crossing');

    unshieldedStates.next(unshieldedAt(unshieldedStates.value, forkVersion));

    const observed = await rx.firstValueFrom(facade.state());

    // The phase follows the streams rather than the moment the facade was built, which is the whole of the wiring.
    expect(observed.protocol).toStrictEqual({ _tag: 'Settled', version: forkVersion });
    expect(observed.activeProtocolVersion).toBe(forkVersion);
  });

  it('keeps the phase readable while a pending transaction is stamped at the version it acts at', async () => {
    shieldedStates.next(shieldedAt(shieldedStates.value, afterFork.shielded));
    dustStates.next(dustAt(dustStates.value, afterFork.dust));

    const observed = await rx.firstValueFrom(facade.state());

    // `from` is not a second opinion: it is the version the facade acts at, which is what anything built during the
    // crossing window is stamped with.
    expect(observed.protocol._tag === 'Crossing' ? Option.some(observed.protocol.from) : Option.none()).toStrictEqual(
      Option.some(observed.activeProtocolVersion),
    );
  });
});
