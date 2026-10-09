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
 * What the wallets reach while a transaction is at the prover, and what the finalized handle says afterwards.
 *
 * @remarks
 *   Proving is the one long await between a transaction being authored and being submitted, so it is the window in which
 *   the three wallets can move — an ordinary block within the same epoch, or the crossing to ledger-v9. The
 *   transaction's bytes were fixed before the prover was called and no chain movement can change them, so the version
 *   the finalized handle carries has to be the one it was authored at, whatever the wallets have reached by the time
 *   the proof comes back.
 *
 *   The suite drives that window directly: a prover it holds mid-flight, and three wallet state streams it moves while
 *   the transaction is waiting there.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  InMemoryTransactionHistoryStorage,
  NetworkId,
  ProtocolVersion,
  ProtocolVersionMismatchError,
  WalletTransaction,
  type FinalizedTx,
  type UnprovenTx,
} from '@midnightntwrk/wallet-sdk-abstractions';
import {
  type V9UnboundTransaction,
  type VersionedProvingService,
} from '@midnightntwrk/wallet-sdk-capabilities/proving';
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BalancingRecipe,
  type ResolvedConfiguration,
  WalletEntrySchema,
  WalletFacade,
  mergeWalletEntries,
} from '../src/index.js';

import {
  createV8MockProvingService,
  drivenBy,
  dustAt,
  getDustSeed,
  getShieldedSeed,
  getUnshieldedSeed,
  shieldedAt,
  SilentPendingTransactions,
  sleep,
  unshieldedAt,
} from './utils/index.js';

/** The boundary this chain forks at. */
const forkVersion = ProtocolVersion.V9NativeForkVersion;

/** Where the three wallets are while the transaction is authored. */
const v8Version = ProtocolVersion.ProtocolVersion(3n);

/** Where an ordinary block within the same epoch puts them while the proof is in flight. */
const laterV8Version = ProtocolVersion.ProtocolVersion(5n);

/** Where the crossing puts them: past the boundary, which is where a wallet that has crossed reports from. */
const v9Version = ProtocolVersion.ProtocolVersion(forkVersion + 1n);

/** A promise the suite settles itself, so a step of the facade can be held open across an assertion. */
const deferred = (): { readonly promise: Promise<void>; readonly settle: () => void } => {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, settle: () => resolve() };
};

/** A prover that holds every transaction until the suite releases it, then proves it as the mock prover would. */
class PausableProving implements VersionedProvingService<V9UnboundTransaction> {
  readonly #proving = createV8MockProvingService();
  readonly #reached = deferred();
  readonly #released = deferred();

  /** Settles once a transaction has reached the prover and is waiting there. */
  readonly reached = this.#reached.promise;

  /** Lets the held transaction go on to be proved. */
  release(): void {
    this.#released.settle();
  }

  async prove(
    transaction: ledgerV9.UnprovenTransaction,
    protocolVersion: ProtocolVersion.ProtocolVersion,
  ): Promise<V9UnboundTransaction> {
    this.#reached.settle();
    await this.#released.promise;
    return await this.#proving.prove(transaction, protocolVersion);
  }
}

/** Records what the facade asks to be tracked as pending, and at which version. */
class RecordingPendingTransactions extends SilentPendingTransactions {
  readonly added: {
    tx: FinalizedTx;
    protocolVersion: Option.Option<ProtocolVersion.ProtocolVersion>;
  }[] = [];

  override addPendingTransaction(
    tx: FinalizedTx,
    protocolVersion: Option.Option<ProtocolVersion.ProtocolVersion>,
  ): Promise<void> {
    this.added.push({ tx, protocolVersion });
    return Promise.resolve();
  }
}

describe('a transaction proved while the wallets move', () => {
  let configuration: ResolvedConfiguration;
  let facade: WalletFacade;
  let proving: PausableProving;
  let pending: RecordingPendingTransactions;
  let shieldedStates: rx.BehaviorSubject<ShieldedWalletState>;
  let unshieldedStates: rx.BehaviorSubject<UnshieldedWalletState>;
  let dustStates: rx.BehaviorSubject<DustWalletState>;

  beforeEach(async () => {
    configuration = {
      networkId: NetworkId.NetworkId.Undeployed,
      forks: { v9: forkVersion },
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: { feeBlocksMargin: 0 },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    };
    const seed = '0000000000000000000000000000000000000000000000000000000000000004';
    const keystore = createKeystore({ kind: 'schnorr', secret: getUnshieldedSeed(seed) }, configuration.networkId);

    // Real, shipped wallets, deliberately never started: this suite supplies their state stream, and starting them
    // would open indexer subscriptions it has no indexer for.
    const shielded = await ShieldedWallet(configuration).startWithSeed(getShieldedSeed(seed));
    const unshielded = await UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(keystore));
    const dust = await DustWallet(configuration).startWithSeed(
      getDustSeed(seed),
      ledgerV9.LedgerParameters.initialParameters().dust,
    );

    shieldedStates = new rx.BehaviorSubject(shieldedAt(await rx.firstValueFrom(shielded.state), v8Version));
    unshieldedStates = new rx.BehaviorSubject(unshieldedAt(await rx.firstValueFrom(unshielded.state), v8Version));
    dustStates = new rx.BehaviorSubject(dustAt(await rx.firstValueFrom(dust.state), v8Version));

    drivenBy(shielded, shieldedStates);
    drivenBy(unshielded, unshieldedStates);
    drivenBy(dust, dustStates);

    proving = new PausableProving();
    pending = new RecordingPendingTransactions();

    facade = await WalletFacade.init({
      configuration,
      shielded: () => shielded,
      unshielded: () => unshielded,
      dust: () => dust,
      provingService: () => proving,
      pendingTransactionsService: () => pending,
    });
  });

  afterEach(async () => {
    proving.release();
    await facade?.stop();
  });

  /** A transaction of the epoch below the boundary, stamped at the version the wallets authored it at. */
  const v8Transaction = (): UnprovenTx =>
    WalletTransaction.adopt(
      'Unproven',
      ledgerV8.Transaction.fromParts(
        configuration.networkId,
        undefined,
        undefined,
        ledgerV8.Intent.new(new Date(Date.now() + 60_000)),
      ),
      v8Version,
    );

  /** Moves all three wallets to a version, and lets the facade observe it. */
  const walletsReach = async (version: ProtocolVersion.ProtocolVersion): Promise<void> => {
    shieldedStates.next(shieldedAt(shieldedStates.value, version));
    unshieldedStates.next(unshieldedAt(unshieldedStates.value, version));
    dustStates.next(dustAt(dustStates.value, version));
    await sleep(0.2);
  };

  it('stamps the finalized transaction at the version it was authored at, not the one reached while proving', async () => {
    const tx = v8Transaction();
    const finalizing = facade.finalizeTransaction(tx);
    await proving.reached;
    await walletsReach(laterV8Version);
    proving.release();

    const finalized = await finalizing;

    expect(finalized.protocolVersion).toBe(tx.protocolVersion);
  });

  it('records the pending transaction at the version it was authored at, so orphaning judges by that', async () => {
    const tx = v8Transaction();
    const finalizing = facade.finalizeTransaction(tx);
    await proving.reached;
    await walletsReach(laterV8Version);
    proving.release();

    const finalized = await finalizing;

    expect(pending.added).toStrictEqual([{ tx: finalized, protocolVersion: Option.some(v8Version) }]);
  });

  it('refuses a transaction whose epoch the wallets left while it was being proved', async () => {
    const tx = v8Transaction();
    const finalizing = facade.finalizeTransaction(tx);
    await proving.reached;
    await walletsReach(v9Version);
    proving.release();

    const failure: unknown = await finalizing.then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ProtocolVersionMismatchError);
    expect((failure as ProtocolVersionMismatchError)._tag).toBe(
      '@midnightntwrk/wallet-sdk-abstractions/WalletTransaction/ProtocolVersionMismatchError',
    );
    expect((failure as ProtocolVersionMismatchError).authoredFor).toBe(v8Version);
    expect((failure as ProtocolVersionMismatchError).accepted).toStrictEqual([
      forkVersion,
      ProtocolVersion.MaxSupportedVersion,
    ]);
  });

  it('gives back what the refused transaction reserved, in all three wallets', async () => {
    const shieldedRevert = vi.spyOn(facade.shielded, 'revertTransaction');
    const unshieldedRevert = vi.spyOn(facade.unshielded, 'revertTransaction');
    const dustRevert = vi.spyOn(facade.dust, 'revertTransaction');
    const tx = v8Transaction();
    const finalizing = facade.finalizeTransaction(tx);
    await proving.reached;
    await walletsReach(v9Version);
    proving.release();

    await expect(finalizing).rejects.toBeInstanceOf(ProtocolVersionMismatchError);

    expect(shieldedRevert).toHaveBeenCalledWith(tx);
    expect(unshieldedRevert).toHaveBeenCalledWith(tx);
    expect(dustRevert).toHaveBeenCalledWith(tx);
  });

  it('tracks nothing as pending for a transaction no chain the wallets are on can include', async () => {
    const finalizing = facade.finalizeTransaction(v8Transaction());
    await proving.reached;
    await walletsReach(v9Version);
    proving.release();

    await expect(finalizing).rejects.toBeInstanceOf(ProtocolVersionMismatchError);

    expect(pending.added).toStrictEqual([]);
  });

  it('stamps a recipe finalized across a move within the epoch at the version the recipe was built for', async () => {
    const recipe: BalancingRecipe = {
      type: 'UNPROVEN_TRANSACTION',
      transaction: v8Transaction(),
      protocolVersion: v8Version,
    };
    const finalizing = facade.finalizeRecipe(recipe);
    await proving.reached;
    await walletsReach(laterV8Version);
    proving.release();

    const finalized = await finalizing;

    expect(finalized.protocolVersion).toBe(v8Version);
    expect(pending.added.map((entry) => entry.protocolVersion)).toStrictEqual([
      Option.some(v8Version),
      Option.some(v8Version),
    ]);
  });
});
