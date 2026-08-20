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

import * as ledger from '@midnightntwrk/ledger-v9';
import {
  InMemoryTransactionHistoryStorage,
  NetworkId,
  ProtocolVersion,
} from '@midnightntwrk/wallet-sdk-abstractions';
import type { UnboundTransaction, VersionedProvingService } from '@midnightntwrk/wallet-sdk-capabilities/proving';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet, V9_NATIVE_FORK_VERSION } from '@midnightntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
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

const PRE_FORK = ProtocolVersion.ProtocolVersion(1_000n);

/** Records the version each transaction is routed to a prover with; erases proofs so the facade can carry on. */
class RecordingProver implements VersionedProvingService<UnboundTransaction> {
  readonly askedFor: ProtocolVersion.ProtocolVersion[] = [];

  prove(
    transaction: ledger.UnprovenTransaction,
    protocolVersion: ProtocolVersion.ProtocolVersion,
  ): Promise<UnboundTransaction> {
    this.askedFor.push(protocolVersion);
    // The unproven transaction is already unbound and carries no real proofs in these tests, so it stands in for the
    // proven result. Type cast required because: the simulator's proof-erased transaction is not `Proof`-typed, and
    // this stand-in only has to travel back through the facade untouched.
    return Promise.resolve(transaction as unknown as UnboundTransaction);
  }
}

describe('Proving a transaction at the version it was built for', () => {
  let configuration: DefaultConfiguration;
  let facade: WalletFacade;
  let prover: RecordingProver;

  beforeEach(async () => {
    configuration = {
      networkId: NetworkId.NetworkId.Undeployed,
      forkVersion: V9_NATIVE_FORK_VERSION,
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
      provingServers: [{ sinceVersion: ProtocolVersion.MinSupportedVersion, url: new URL('http://localhost:6300') }],
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
      unshielded: () =>
        UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
      dust: () => DustWallet(configuration).startWithSeed(dustSeed, ledger.LedgerParameters.initialParameters().dust),
      provingService: () => prover,
    });
    // The wallets are not started: these tests observe the state the facade already has, and starting them
    // would open indexer subscriptions this suite has no indexer for.
  });

  afterEach(async () => {
    await facade?.stop();
  });

  const anyTransaction = (): ledger.UnprovenTransaction =>
    ledger.Transaction.fromParts(
      configuration.networkId,
      undefined,
      undefined,
      ledger.Intent.new(new Date(Date.now() + 60_000)),
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
    expect(observed.activeProtocolVersion).not.toStrictEqual(PRE_FORK);

    const recipe: BalancingRecipe = {
      type: 'UNPROVEN_TRANSACTION',
      transaction: anyTransaction(),
      protocolVersion: PRE_FORK,
    };

    await facade.finalizeRecipe(recipe);

    expect(prover.askedFor).toStrictEqual([PRE_FORK]);
  });

  it('proves at an explicitly given version when one is passed', async () => {
    await facade.finalizeTransaction(anyTransaction(), PRE_FORK);

    expect(prover.askedFor).toStrictEqual([PRE_FORK]);
  });
});
