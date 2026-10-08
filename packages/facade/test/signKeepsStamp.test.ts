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
 * Signing a transaction leaves the version it is stamped with alone.
 *
 * @remarks
 *   A stamp says which version fixed a transaction's bytes. Signing adds signatures to those bytes and changes nothing
 *   about which ledger version wrote them, so a handle that goes through `signRecipe` has to come back stamped as it
 *   went in — and a recipe with nothing to sign has to come back equal to the one handed over. The handle here comes
 *   from `adoptTransaction`, which is how a dApp connector's transaction enters the wallet, stamped with the version
 *   the facade is acting at. It is adopted at both stages a dApp hands one over at, because the two are signed through
 *   different calls: an unproven recipe's transaction, and an unbound recipe's base transaction.
 *
 *   Both sides of the boundary are covered, because the unshielded wallet signs through a different variant on each: a
 *   Schnorr identity starts on the V1 variant and stays there while nothing hands it over, and an ECDSA identity, which
 *   only ledger-v9 can express, starts on the V2 variant. The wallets are never started against an indexer; their state
 *   streams are driven, as in `adoptTransaction.test.ts`, so the version the facade acts at is chosen by the suite.
 *
 *   The versions are deliberately not the floor of either epoch: a version equal to the floor would let a re-stamp at the
 *   floor pass as the stamp being kept.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { InMemoryTransactionHistoryStorage, NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import * as rx from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
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
  unshieldedAt,
} from './utils/index.js';

const NETWORK_ID = NetworkId.NetworkId.Undeployed;

const forkVersion = ProtocolVersion.V9NativeForkVersion;

const seed = '0000000000000000000000000000000000000000000000000000000000000002';

/** A version on each side of the boundary, neither of them the floor of its epoch. */
const belowFork = ProtocolVersion.ProtocolVersion(1_234_001n);
const fromFork = ProtocolVersion.ProtocolVersion(forkVersion + 1_000n);

/**
 * A transaction with nothing to sign. Every intent is a signable segment, so it has none — the shape the e2e suite's
 * shielded-only transaction has, which is where the stamp was first seen to change.
 */
const v8Bytes = (): Uint8Array => ledgerV8.Transaction.fromParts(NETWORK_ID).serialize();

const v9Bytes = (): Uint8Array => ledgerV9.Transaction.fromParts(NETWORK_ID).serialize();

/** A prover that is never asked anything: a transaction with nothing in it has nothing to prove. */
const noProofs = {
  check: () => Promise.resolve([]),
  prove: () => Promise.reject(new Error('A transaction with nothing in it should have nothing to prove')),
  lookupKey: () => Promise.resolve(undefined),
};

/** The same transaction at the unbound stage: proved, which is how a dApp hands one over, and not yet bound. */
const v8UnboundBytes = async (): Promise<Uint8Array> =>
  (
    await ledgerV8.Transaction.fromParts(NETWORK_ID).prove(
      noProofs,
      ledgerV8.LedgerParameters.initialParameters().transactionCostModel.runtimeCostModel,
    )
  ).serialize();

const v9UnboundBytes = async (): Promise<Uint8Array> =>
  (
    await ledgerV9.Transaction.fromParts(NETWORK_ID).prove(
      noProofs,
      ledgerV9.LedgerParameters.initialParameters().transactionCostModel.runtimeCostModel,
    )
  ).serialize();

const noSignatureExpected = (): never => {
  throw new Error('No signature segment should be requested for a transaction with no intents');
};

/** A facade over the shipped wallets, all three reporting `version`, with the unshielded identity of `kind`. */
const facadeAt = async (kind: 'schnorr' | 'ecdsa', version: ProtocolVersion.ProtocolVersion): Promise<WalletFacade> => {
  const configuration: ResolvedConfiguration = {
    networkId: NETWORK_ID,
    forks: { v9: forkVersion },
    relayURL: new URL('http://localhost:9944'),
    indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
    provingServerUrl: new URL('http://localhost:6300'),
    costParameters: { feeBlocksMargin: 0 },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
  };
  const keystore = createKeystore({ kind, secret: getUnshieldedSeed(seed) }, configuration.networkId);

  const shielded = await ShieldedWallet(configuration).startWithSeed(getShieldedSeed(seed));
  const unshielded = await UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(keystore));
  const dust = await DustWallet(configuration).startWithSeed(
    getDustSeed(seed),
    ledgerV9.LedgerParameters.initialParameters().dust,
  );

  drivenBy(shielded, new rx.BehaviorSubject(shieldedAt(await rx.firstValueFrom(shielded.state), version)));
  drivenBy(unshielded, new rx.BehaviorSubject(unshieldedAt(await rx.firstValueFrom(unshielded.state), version)));
  drivenBy(dust, new rx.BehaviorSubject(dustAt(await rx.firstValueFrom(dust.state), version)));

  const facade = await WalletFacade.init({
    configuration,
    shielded: () => shielded,
    unshielded: () => unshielded,
    dust: () => dust,
    provingService: () => createV8MockProvingService(),
    pendingTransactionsService: () => new SilentPendingTransactions(),
  });
  expect((await rx.firstValueFrom(facade.state())).activeProtocolVersion).toBe(version);
  return facade;
};

describe('WalletFacade.signRecipe keeps the stamp of the transaction it signs', () => {
  let facade: WalletFacade | undefined;

  afterEach(async () => {
    await facade?.stop();
    facade = undefined;
  });

  const sides = [
    {
      side: 'below the boundary (V1 variant, Schnorr identity)',
      kind: 'schnorr',
      version: belowFork,
      unprovenBytes: v8Bytes,
      unboundBytes: v8UnboundBytes,
    },
    {
      side: 'from the boundary (V2 variant, ECDSA identity)',
      kind: 'ecdsa',
      version: fromFork,
      unprovenBytes: v9Bytes,
      unboundBytes: v9UnboundBytes,
    },
  ] as const;

  it.each(sides)('of an unproven recipe, $side', async ({ kind, version, unprovenBytes }) => {
    facade = await facadeAt(kind, version);
    const handle = facade.adoptTransaction(unprovenBytes(), 'Unproven');
    expect(handle.protocolVersion).toBe(version);
    const recipe: BalancingRecipe = { type: 'UNPROVEN_TRANSACTION', protocolVersion: version, transaction: handle };

    const signed = await facade.signRecipe(recipe, noSignatureExpected);

    expect(signed.type).toBe('UNPROVEN_TRANSACTION');
    expect(signed.type === 'UNPROVEN_TRANSACTION' && signed.transaction.protocolVersion).toBe(version);
    expect(signed).toEqual(recipe);
  });

  // The unbound recipe is signed through the other signing call, on its base transaction — the one a dApp handed over
  // already proved, and so the one whose stamp came from `adoptTransaction`.
  it.each(sides)('of an unbound recipe, $side', async ({ kind, version, unboundBytes }) => {
    facade = await facadeAt(kind, version);
    const handle = facade.adoptTransaction(await unboundBytes(), 'Unbound');
    expect(handle.protocolVersion).toBe(version);
    const recipe: BalancingRecipe = { type: 'UNBOUND_TRANSACTION', protocolVersion: version, baseTransaction: handle };

    const signed = await facade.signRecipe(recipe, noSignatureExpected);

    expect(signed.type).toBe('UNBOUND_TRANSACTION');
    expect(signed.type === 'UNBOUND_TRANSACTION' && signed.baseTransaction.protocolVersion).toBe(version);
    expect(signed).toEqual(recipe);
  });
});
