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
 * Reading a transaction the SDK did not build, from bytes that name no version.
 *
 * @remarks
 *   A dApp connector hands the wallet a serialized transaction and nothing else — the connector contract carries no
 *   protocol version — so the bytes alone cannot say which ledger version wrote them. The facade answers with the only
 *   version it can be held to: the one its three wallets are acting at. This suite pins that it reads with that
 *   version's ledger, stamps the handle with that version, and refuses bytes written by the other one rather than
 *   letting them through to fail later.
 *
 *   The three wallets' states are driven, as in `protocolPhaseWiring.test.ts`: which side of the boundary the facade is
 *   on is precisely what decides the answer here, so both sides have to be reachable within one suite.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  InMemoryTransactionHistoryStorage,
  NetworkId,
  ProtocolVersion,
  WireFormatError,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { DustWallet, type DustWalletState } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet, type ShieldedWalletState } from '@midnightntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedWalletState,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import * as rx from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ResolvedConfiguration, WalletEntrySchema, WalletFacade, mergeWalletEntries } from '../src/index.js';

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

/** The boundary the facade picks its ledger version against. */
const forkVersion = ProtocolVersion.V9NativeForkVersion;

/**
 * Three versions below the boundary and three at or past it, all distinct and none of them a round number: what the
 * facade acts at is the lowest of the three, and it has to appear in a refusal, so a version that could be confused
 * with a length, an index or another wallet's version would make those assertions pass for the wrong reason.
 */
const belowFork = {
  shielded: ProtocolVersion.ProtocolVersion(1_234_003n),
  unshielded: ProtocolVersion.ProtocolVersion(1_234_001n),
  dust: ProtocolVersion.ProtocolVersion(1_234_002n),
} as const;

const fromFork = {
  shielded: ProtocolVersion.ProtocolVersion(forkVersion + 9n),
  unshielded: ProtocolVersion.ProtocolVersion(forkVersion + 7n),
  dust: ProtocolVersion.ProtocolVersion(forkVersion + 8n),
} as const;

/** What the facade acts at on either side: the lowest the three wallets have reached. */
const activeBelowFork = belowFork.unshielded;
const activeFromFork = fromFork.unshielded;

const ttl = (): Date => new Date(Date.now() + 60 * 60 * 1000);

/** An ordinary transaction of either ledger version, as bytes — which is all a connector ever hands over. */
const v8Bytes = (): Uint8Array =>
  ledgerV8.Transaction.fromParts(NETWORK_ID, undefined, undefined, ledgerV8.Intent.new(ttl())).serialize();

const v9Bytes = (): Uint8Array =>
  ledgerV9.Transaction.fromParts(NETWORK_ID, undefined, undefined, ledgerV9.Intent.new(ttl())).serialize();

describe('WalletFacade.adoptTransaction', () => {
  let facade: WalletFacade;
  let shieldedStates: rx.BehaviorSubject<ShieldedWalletState>;
  let unshieldedStates: rx.BehaviorSubject<UnshieldedWalletState>;
  let dustStates: rx.BehaviorSubject<DustWalletState>;

  /** Moves all three wallets past the boundary, which is the only way the facade changes the ledger it reads with. */
  const crossTheFork = async (): Promise<void> => {
    shieldedStates.next(shieldedAt(shieldedStates.value, fromFork.shielded));
    unshieldedStates.next(unshieldedAt(unshieldedStates.value, fromFork.unshielded));
    dustStates.next(dustAt(dustStates.value, fromFork.dust));
    expect((await rx.firstValueFrom(facade.state())).activeProtocolVersion).toBe(activeFromFork);
  };

  beforeEach(async () => {
    const configuration: ResolvedConfiguration = {
      networkId: NETWORK_ID,
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
      ledgerV9.LedgerParameters.initialParameters().dust,
    );

    shieldedStates = new rx.BehaviorSubject(shieldedAt(await rx.firstValueFrom(shielded.state), belowFork.shielded));
    unshieldedStates = new rx.BehaviorSubject(
      unshieldedAt(await rx.firstValueFrom(unshielded.state), belowFork.unshielded),
    );
    dustStates = new rx.BehaviorSubject(dustAt(await rx.firstValueFrom(dust.state), belowFork.dust));

    drivenBy(shielded, shieldedStates);
    drivenBy(unshielded, unshieldedStates);
    drivenBy(dust, dustStates);

    facade = await WalletFacade.init({
      configuration,
      shielded: () => shielded,
      unshielded: () => unshielded,
      dust: () => dust,
      provingService: () => createV8MockProvingService(),
      pendingTransactionsService: () => new SilentPendingTransactions(),
    });
  });

  afterEach(async () => {
    await facade?.stop();
  });

  it('reads the bytes with the ledger version the wallets are acting at, and stamps the handle with it', () => {
    const bytes = v8Bytes();

    const handle = facade.adoptTransaction(bytes, 'Unproven');

    expect(handle.stage).toBe('Unproven');
    expect(handle.protocolVersion).toBe(activeBelowFork);
    // Byte-for-byte what went in: the handle carries the transaction those bytes describe, not the bytes themselves.
    expect(Uint8Array.from(handle.serialize())).toStrictEqual(bytes);
  });

  it('follows the wallets across the boundary rather than the version it was built at', async () => {
    await crossTheFork();
    const bytes = v9Bytes();

    const handle = facade.adoptTransaction(bytes, 'Unproven');

    expect(handle.protocolVersion).toBe(activeFromFork);
    expect(Uint8Array.from(handle.serialize())).toStrictEqual(bytes);
  });

  it('refuses bytes the other ledger version wrote, naming the version it is acting at', () => {
    // Below the boundary the facade acts on ledger-v8, so a dApp that authored on ledger-v9 is refused — and told
    // which version it should have authored for, which the tag mismatch underneath cannot say.
    expect(() => facade.adoptTransaction(v9Bytes(), 'Unproven')).toThrow(WireFormatError);
    expect(() => facade.adoptTransaction(v9Bytes(), 'Unproven')).toThrow(String(activeBelowFork));
  });

  it('refuses bytes of its own ledger version once the wallets have left that version behind', async () => {
    await crossTheFork();

    expect(() => facade.adoptTransaction(v8Bytes(), 'Unproven')).toThrow(WireFormatError);
    expect(() => facade.adoptTransaction(v8Bytes(), 'Unproven')).toThrow(String(activeFromFork));
  });

  it('refuses bytes that are not at the stage it was asked for', () => {
    // The stage decides which markers the bytes are read with, and the markers are part of what the ledger checks:
    // an unproven transaction read as a finalized one is not a transaction the wallet can act on.
    expect(() => facade.adoptTransaction(v8Bytes(), 'Finalized')).toThrow(WireFormatError);
  });
});
