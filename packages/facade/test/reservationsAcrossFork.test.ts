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
 * Reservations taken while the chain is still below `forks.v9`.
 *
 * @remarks
 *   A reservation names the coins balancing booked, and the facade reads those coins off the transaction the unshielded
 *   wallet built. Below the boundary that transaction is a ledger-v8 one, built by the V1 variant, and this wallet's
 *   key has ledger-v8's bare shape, so the facade has to read it as ledger-v8 bytes. Every other reservation suite runs
 *   a chain that is on ledger-v9 from its first block, so this is the only place the ledger-v8 reading is exercised.
 *
 *   The unshielded wallet here is the shipped forking composition with each variant syncing from a simulated chain of its
 *   own ledger version, and the chain it reads is a ledger-v8 one that never reaches the boundary. The shielded and
 *   dust wallets are real, never started, and driven at the chain's version: a transfer of Night that pays no fee needs
 *   nothing from them but the version they report.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  type FinalizedTx,
  InMemoryTransactionHistoryStorage,
  NetworkId,
  NoOpTransactionHistoryStorage,
  ProtocolVersion,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import { Simulator, V8 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { CustomForkingUnshieldedWallet, createKeystore, PublicKey } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { Migration as V1Migration, Sync as V1Sync, V1Builder } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v1';
import { Migration as V2Migration, Sync as V2Sync, V2Builder } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v2';
import { Effect } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  type FacadeState,
  type ResolvedConfiguration,
  type WalletEntry,
  WalletEntrySchema,
  WalletFacade,
  mergeWalletEntries,
} from '../src/index.js';
import {
  drivenBy,
  dustAt,
  getDustSeed,
  getShieldedSeed,
  getUnshieldedSeed,
  shieldedAt,
  tokenValue,
} from './utils/index.js';

vi.setConfig({ testTimeout: 30_000 });

const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const SEED = '0000000000000000000000000000000000000000000000000000000000000005';

/** The boundary, deliberately above every version the ledger-v8 chain here reaches. */
const forkVersion = ProtocolVersion.V9NativeForkVersion;

/** The version the ledger-v8 chain runs at, and so the one every wallet reports. */
const v8Version = ProtocolVersion.MinSupportedVersion;

const V8_NIGHT = ledgerV8.nativeToken().raw;

const utxoKey = (coin: { utxo: { intentHash: string; outputNo: number } }): string =>
  `${coin.utxo.intentHash}#${coin.utxo.outputNo}`;

/** The pending set as the facade's pending-transactions service holds it, which is where reservations live. */
const pendingSet = (facade: WalletFacade): Effect.Effect<PendingTransactions.PendingTransactions<FinalizedTx>> =>
  Effect.promise(() => rx.firstValueFrom(facade.pendingTransactionsService.state()));

/** A fork-aware facade over a ledger-v8 chain that has paid this wallet Night, with the unshielded wallet syncing it. */
const facadeBelowTheFork = () =>
  Effect.gen(function* () {
    const keystore = createKeystore({ kind: 'schnorr', secret: getUnshieldedSeed(SEED) }, NETWORK_ID);
    const publicKey = PublicKey.fromKeyStore(keystore);
    // Ledger-v8 has one signature scheme, so its verifying key is the bare value of ledger-v9's schnorr one.
    const v8VerifyingKey: ledgerV8.SignatureVerifyingKey = publicKey.publicKey.value;

    const v8Chain = yield* V8.Simulator.init({
      networkId: NETWORK_ID,
      protocolVersion: v8Version,
      genesisMints: [
        {
          type: 'unshielded',
          tokenType: V8_NIGHT,
          amount: tokenValue(100_000n),
          recipient: ledgerV8.addressFromKey(v8VerifyingKey),
          verifyingKey: v8VerifyingKey,
        },
      ],
    });
    // The ledger-v9 variant is registered but never reached; its chain only has to exist.
    const v9Chain = yield* Simulator.init({ networkId: NETWORK_ID });

    const configuration: ResolvedConfiguration = {
      networkId: NETWORK_ID,
      forks: { v9: forkVersion },
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: { feeBlocksMargin: 0 },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    };

    const UnshieldedWallet = CustomForkingUnshieldedWallet(
      { networkId: NETWORK_ID, forks: configuration.forks },
      {
        builder: new V1Builder()
          .withSync(V1Sync.makeSimulatorSyncService, V1Sync.makeSimulatorSyncCapability)
          .withSerializationDefaults()
          .withTransactingDefaults()
          .withSigningDefaults()
          .withCoinsAndBalancesDefaults()
          .withKeysDefaults()
          .withCoinSelectionDefaults()
          .withTransactionHistoryDefaults()
          .withMigration(() => V1Migration.makeEmptyWalletMigration({ networkId: NETWORK_ID })),
        configuration: {
          networkId: NETWORK_ID,
          simulator: v8Chain,
          txHistoryStorage: new NoOpTransactionHistoryStorage<WalletEntry>(),
        },
      },
      {
        builder: new V2Builder()
          .withSync(V2Sync.makeSimulatorSyncService, V2Sync.makeSimulatorSyncCapability)
          .withSerializationDefaults()
          .withTransactingDefaults()
          .withSigningDefaults()
          .withCoinsAndBalancesDefaults()
          .withKeysDefaults()
          .withCoinSelectionDefaults()
          .withTransactionHistoryDefaults()
          .withMigration(() => V2Migration.makeCrossLedgerMigration()),
        configuration: {
          networkId: NETWORK_ID,
          simulator: v9Chain,
          txHistoryStorage: new NoOpTransactionHistoryStorage<WalletEntry>(),
        },
      },
    );
    const unshielded = yield* Effect.promise(() => UnshieldedWallet.startWithPublicKey(publicKey));

    // Never started: these two wallets would otherwise open indexer subscriptions this suite has no indexer for.
    const shielded = yield* Effect.promise(() => ShieldedWallet(configuration).startWithSeed(getShieldedSeed(SEED)));
    const dust = yield* Effect.promise(() =>
      DustWallet(configuration).startWithSeed(getDustSeed(SEED), ledgerV9.LedgerParameters.initialParameters().dust),
    );
    const shieldedState = yield* Effect.promise(() => rx.firstValueFrom(shielded.state));
    const dustState = yield* Effect.promise(() => rx.firstValueFrom(dust.state));
    drivenBy(shielded, new rx.BehaviorSubject(shieldedAt(shieldedState, v8Version)));
    drivenBy(dust, new rx.BehaviorSubject(dustAt(dustState, v8Version)));

    const facade = yield* Effect.acquireRelease(
      Effect.promise(() =>
        WalletFacade.init({
          configuration,
          shielded: () => shielded,
          unshielded: () => unshielded,
          dust: () => dust,
        }),
      ),
      (started) => Effect.promise(() => started.stop()),
    );

    yield* Effect.promise(() => unshielded.start());
    yield* Effect.promise(() =>
      rx.firstValueFrom(facade.state().pipe(rx.filter((state) => state.unshielded.availableCoins.length > 0))),
    );

    return facade;
  });

describe('A reservation taken below forks.v9', () => {
  it('names exactly the coins the V1 wallet booked for the transfer', () =>
    Effect.gen(function* () {
      const facade = yield* facadeBelowTheFork();
      const address = yield* Effect.promise(() => facade.unshielded.getAddress());

      const recipe = yield* Effect.promise(() =>
        facade.transferTransaction(
          [{ type: 'unshielded', outputs: [{ type: V8_NIGHT, receiverAddress: address, amount: tokenValue(1n) }] }],
          { ttl: new Date(Date.now() + 60 * 60 * 1000), payFees: false },
        ),
      );

      // The transfer was built on ledger-v8, which is the reading under test.
      expect(recipe.transaction.protocolVersion).toBeLessThan(forkVersion);

      // The wallet publishes its booking on its own fiber, so wait for it rather than read the state straight away.
      const after: FacadeState = yield* Effect.promise(() =>
        rx.firstValueFrom(facade.state().pipe(rx.filter((state) => state.unshielded.pendingCoins.length > 0))),
      );
      const booked = after.unshielded.pendingCoins.map(utxoKey).toSorted();

      const pending = yield* pendingSet(facade);
      expect(pending.reservations).toHaveLength(1);
      expect(pending.reservations[0].inputs.unshielded.toSorted()).toEqual(booked);
    }).pipe(Effect.scoped, Effect.runPromise));
});
