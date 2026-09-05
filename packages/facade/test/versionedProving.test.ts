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

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  InMemoryTransactionHistoryStorage,
  NetworkId,
  ProtocolVersion,
  ProtocolVersionMismatchError,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import {
  ProvingEpochMismatchError,
  UnsupportedProvingVersionError,
  type ProvingBackends,
  type V9UnboundTransaction,
  type VersionedProvingService,
} from '@midnightntwrk/wallet-sdk-capabilities/proving';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { Cause, Either, Option, Runtime } from 'effect';
import * as rx from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BalancingRecipe,
  type DefaultConfiguration,
  WalletEntrySchema,
  WalletFacade,
  mergeWalletEntries,
} from '../src/index.js';
import { getDustSeed, getShieldedSeed, getUnshieldedSeed } from './utils/index.js';

vi.setConfig({ testTimeout: 20_000, hookTimeout: 120_000 });

const V8_VERSION = ProtocolVersion.ProtocolVersion(1_000n);

/** Records the version each transaction is routed to a prover with; erases proofs so the facade can carry on. */
class RecordingProver implements VersionedProvingService<V9UnboundTransaction> {
  readonly askedFor: ProtocolVersion.ProtocolVersion[] = [];

  prove(
    transaction: ledgerV9.UnprovenTransaction,
    protocolVersion: ProtocolVersion.ProtocolVersion,
  ): Promise<V9UnboundTransaction> {
    this.askedFor.push(protocolVersion);
    // The unproven transaction is already unbound and carries no real proofs in these tests, so it stands in for the
    // proven result. Type cast required because: the simulator's proof-erased transaction is not `Proof`-typed, and
    // this stand-in only has to travel back through the facade untouched.
    return Promise.resolve(transaction as unknown as V9UnboundTransaction);
  }
}

describe('Proving a transaction at the version it was built for', () => {
  let configuration: DefaultConfiguration;
  let facade: WalletFacade;
  let prover: RecordingProver;

  beforeEach(async () => {
    configuration = {
      networkId: NetworkId.NetworkId.Undeployed,
      forks: { v9: ProtocolVersion.V9NativeForkVersion },
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: { feeBlocksMargin: 0 },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    };
    const seed = '0000000000000000000000000000000000000000000000000000000000000001';
    const shieldedSeed = getShieldedSeed(seed);
    const unshieldedSeed = getUnshieldedSeed(seed);
    const dustSeed = getDustSeed(seed);
    const unshieldedKeystore = createKeystore({ kind: 'schnorr', secret: unshieldedSeed }, configuration.networkId);
    prover = new RecordingProver();

    facade = await WalletFacade.init({
      configuration,
      shielded: () => ShieldedWallet(configuration).startWithSeed(shieldedSeed),
      unshielded: () => UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
      dust: () => DustWallet(configuration).startWithSeed(dustSeed, ledgerV9.LedgerParameters.initialParameters().dust),
      provingService: () => prover,
    });
    // The wallets are not started: these tests observe the state the facade already has, and starting them
    // would open indexer subscriptions this suite has no indexer for.
  });

  afterEach(async () => {
    await facade?.stop();
  });

  const anyTransaction = (stamp: ProtocolVersion.ProtocolVersion = ProtocolVersion.MinSupportedVersion) =>
    WalletTransaction.adopt(
      'Unproven',
      ledgerV9.Transaction.fromParts(
        configuration.networkId,
        undefined,
        undefined,
        ledgerV9.Intent.new(new Date(Date.now() + 60_000)),
      ),
      stamp,
    );

  it('proves at the version the wallets have reached when nothing says otherwise', async () => {
    const observed = await rx.firstValueFrom(facade.state());

    await facade.finalizeTransaction(anyTransaction());

    expect(prover.askedFor).toStrictEqual([observed.activeProtocolVersion]);
  });

  it('proves a recipe at the version it was built for, not the version the chain has since reached', async () => {
    // The fork can land between balancing and proving. The recipe's bytes were fixed when it was built, so its own
    // stamp is what decides which prover can read them.
    const observed = await rx.firstValueFrom(facade.state());
    expect(observed.activeProtocolVersion).not.toStrictEqual(V8_VERSION);

    const recipe: BalancingRecipe = {
      type: 'UNPROVEN_TRANSACTION',
      transaction: anyTransaction(V8_VERSION),
      protocolVersion: V8_VERSION,
    };

    await facade.finalizeRecipe(recipe);

    expect(prover.askedFor).toStrictEqual([V8_VERSION]);
  });

  it('proves at the version the transaction itself was built at, which is the only one it can be proved at', async () => {
    // There is no way to name a version separately from the transaction any more, and that is the point: the stamp
    // travels with the bytes it describes, so the two cannot disagree.
    await facade.finalizeTransaction(anyTransaction(V8_VERSION));

    expect(prover.askedFor).toStrictEqual([V8_VERSION]);
  });

  it('refuses a transaction built on the other side of the boundary, without asking any prover', async () => {
    const failure = await facade.finalizeTransaction(anyTransaction(ProtocolVersion.V9NativeForkVersion)).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ProtocolVersionMismatchError);
    expect(prover.askedFor).toStrictEqual([]);
  });
});

describe('Proving with the backend configured for the epoch a transaction belongs to', () => {
  const facades: WalletFacade[] = [];

  afterEach(async () => {
    await Promise.allSettled(facades.splice(0).map((facade) => facade.stop()));
  });

  /** A facade built with the default proving service, so what is under test is the wiring rather than a stand-in. */
  const started = async (proving: Partial<DefaultConfiguration>): Promise<WalletFacade> => {
    const configuration: DefaultConfiguration = {
      networkId: NetworkId.NetworkId.Undeployed,
      forks: { v9: ProtocolVersion.V9NativeForkVersion },
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
      costParameters: { feeBlocksMargin: 0 },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
      ...proving,
    };
    const seed = '0000000000000000000000000000000000000000000000000000000000000001';
    const unshieldedKeystore = createKeystore(
      { kind: 'schnorr', secret: getUnshieldedSeed(seed) },
      configuration.networkId,
    );

    const facade = await WalletFacade.init({
      configuration,
      shielded: () => ShieldedWallet(configuration).startWithSeed(getShieldedSeed(seed)),
      unshielded: () => UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
      dust: () =>
        DustWallet(configuration).startWithSeed(getDustSeed(seed), ledgerV9.LedgerParameters.initialParameters().dust),
    });
    facades.push(facade);
    return facade;
    // The wallets are not started, for the same reason as above: this suite has no indexer to subscribe to.
  };

  /**
   * A ledger-v8 transaction with nothing in it that needs a proof, stamped below the boundary.
   *
   * @remarks
   *   Nothing to prove means no backend is ever reached over the network, which is what lets these tests name proof
   *   servers that do not exist. What is observable is the only thing that matters here: which ledger version drove the
   *   proving, and therefore which ledger version's transaction comes back.
   */
  const aV8Transaction = () =>
    WalletTransaction.adopt(
      'Unproven',
      ledgerV8.Transaction.fromParts(
        NetworkId.NetworkId.Undeployed,
        undefined,
        undefined,
        ledgerV8.Intent.new(new Date(Date.now() + 60_000)),
      ),
      V8_VERSION,
    );

  /** A ledger-v9 transaction wearing a ledger-v8 stamp: the stamp the facade reads, the bytes it does not. */
  const aMisstampedV9Transaction = () =>
    WalletTransaction.adopt(
      'Unproven',
      ledgerV9.Transaction.fromParts(
        NetworkId.NetworkId.Undeployed,
        undefined,
        undefined,
        ledgerV9.Intent.new(new Date(Date.now() + 60_000)),
      ),
      V8_VERSION,
    );

  /**
   * The error a rejected facade call actually reports.
   *
   * @remarks
   *   Proving is the one facade path whose failures come back through an Effect runtime, so they arrive wrapped rather
   *   than as themselves. What the caller is entitled to is inside; this is where the test looks for it, rather than
   *   loosening what it asserts about the failure.
   */
  const reported = (error: unknown): unknown =>
    Runtime.isFiberFailure(error)
      ? Option.getOrElse(Cause.failureOption(error[Runtime.FiberFailureCauseId]), () => error)
      : error;

  const provenBy = (finalized: WalletTransaction<WalletTransaction.Stage>) =>
    Either.getOrThrow(
      WalletTransaction.unwrapWithin<unknown>(
        finalized,
        ProtocolVersion.epochOf(V8_VERSION, ProtocolVersion.V9NativeForkVersion),
      ),
    );

  const v8ServerAndV9Wasm: Partial<DefaultConfiguration> = {
    provers: { v8: { kind: 'server', url: new URL('http://v8-prover:6300') }, v9: { kind: 'wasm' } },
  };

  it('proves a transaction built below the fork with ledger-v8', async () => {
    const facade = await started(v8ServerAndV9Wasm);

    const finalized = await facade.finalizeTransaction(aV8Transaction());

    expect(provenBy(finalized)).toBeInstanceOf(ledgerV8.Transaction);
  });

  it('drives the single-server configuration with ledger-v8 below the fork the wallet was configured with', async () => {
    // Naming one server for every version says nothing about ledger versions, and cannot. What makes it right below the
    // boundary is that the facade hands proving the same fork schedule it hands its wallets.
    const facade = await started({ provingServerUrl: new URL('http://only-prover:6300') });

    const finalized = await facade.finalizeTransaction(aV8Transaction());

    expect(provenBy(finalized)).toBeInstanceOf(ledgerV8.Transaction);
  });

  it('refuses a ledger-v9 transaction wearing a ledger-v8 stamp, rather than handing it to a ledger that cannot read it', async () => {
    const facade = await started(v8ServerAndV9Wasm);

    const failure = await facade.finalizeTransaction(aMisstampedV9Transaction()).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(reported(failure)).toBeInstanceOf(ProvingEpochMismatchError);
  });

  it('refuses a transaction from a version no backend was configured for, naming that version', async () => {
    const facade = await started({
      provers: { v9: { kind: 'server', url: new URL('http://v9-prover:6300') } },
    });

    const failure = await facade.finalizeTransaction(aV8Transaction()).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(reported(failure)).toBeInstanceOf(UnsupportedProvingVersionError);
    expect((reported(failure) as UnsupportedProvingVersionError).protocolVersion).toStrictEqual(V8_VERSION);
  });
});

describe('DefaultConfiguration', () => {
  it('names a proving backend per ledger version, keyed the way `forks` is', () => {
    type _1 = Expect<Equal<DefaultConfiguration['provers'], ProvingBackends | undefined>>;
  });

  it('no longer takes proof servers keyed by the protocol version each starts serving', () => {
    type _1 = Expect<Equal<'provingServers' extends keyof DefaultConfiguration ? true : false, false>>;
  });
});
