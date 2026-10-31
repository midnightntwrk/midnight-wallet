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
 * Starting the facade over wallets restored from snapshots written below `forks.v9`.
 *
 * @remarks
 *   A snapshot carries no key material, so a restored wallet holds none until it is started. Restored below the boundary
 *   it resumes on its V1 variant, which runs ledger-v8 and so needs ledger-v8 keys. Seeds derive those as readily as
 *   ledger-v9's, and `FacadeKeysByEpoch` carries them outright — so a facade started from either must resume these
 *   wallets where their snapshots left them, rather than fail for want of keys the caller handed over.
 *
 *   Manual synchronization is the exception: it steps the dust wallet's projections sync, which only ledger-v9 has. A
 *   facade asked for it while the dust wallet is below `forks.v9` refuses — in `start()` before starting anything, so
 *   that starting again without it is a first start, and in `doSync()` — rather than leave a wallet nothing will move.
 *
 *   The shielded and dust wallets are the shipped forking compositions, each variant syncing from a simulated chain of
 *   its own ledger version; the chain they read is a ledger-v8 one that never reaches the boundary.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { NetworkId, NoOpTransactionHistoryStorage, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { V8, V9 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { CustomForkingDustWallet, ManualSyncUnsupportedError } from '@midnightntwrk/wallet-sdk-dust-wallet';
import * as DustV1 from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
import * as DustV2 from '@midnightntwrk/wallet-sdk-dust-wallet/v2';
import { WalletSeeds } from '@midnightntwrk/wallet-sdk-hd';
import { CustomForkingShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import * as ShieldedV1 from '@midnightntwrk/wallet-sdk-shielded/v1';
import * as ShieldedV2 from '@midnightntwrk/wallet-sdk-shielded/v2';
import { CustomForkingUnshieldedWallet, createKeystore, PublicKey } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import * as UnshieldedV1 from '@midnightntwrk/wallet-sdk-unshielded-wallet/v1';
import * as UnshieldedV2 from '@midnightntwrk/wallet-sdk-unshielded-wallet/v2';
import { Effect } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { type FacadeStartMaterial, type WalletEntry, WalletFacade } from '../src/index.js';
import { createV8MockProvingService, SilentPendingTransactions } from './utils/index.js';

vi.setConfig({ testTimeout: 30_000 });

const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const MASTER_SEED = Buffer.from('0000000000000000000000000000000000000000000000000000000000000007', 'hex');

/** The boundary, deliberately above every version the ledger-v8 chain here reaches. */
const forkVersion = ProtocolVersion.V9NativeForkVersion;

/** Every wallet here syncs from a simulator; the indexer the default configuration names is never contacted. */
const UNUSED_INDEXER = { indexerHttpUrl: 'http://unused:0' };

const v8DustParameters = ledgerV8.LedgerParameters.initialParameters().dust;
const v9DustParameters = ledgerV9.LedgerParameters.initialParameters().dust;

/**
 * A facade whose shielded and dust wallets were restored from snapshots their own V1 variants wrote, and so hold no key
 * material until the facade starts them.
 */
const facadeOverRestoredWallets = (
  seeds: WalletSeeds,
  pendingTransactions: SilentPendingTransactions = new SilentPendingTransactions(),
) =>
  Effect.gen(function* () {
    const v8Chain = yield* V8.Simulator.init({
      networkId: NETWORK_ID,
      protocolVersion: ProtocolVersion.MinSupportedVersion,
    });
    // The ledger-v9 variants are registered but never reached; their chain only has to exist.
    const v9Chain = yield* V9.Simulator.init({ networkId: NETWORK_ID });
    const forkingConfiguration = { networkId: NETWORK_ID, forks: { v9: forkVersion } };

    const ShieldedWallet = CustomForkingShieldedWallet(
      forkingConfiguration,
      {
        builder: new ShieldedV1.V1Builder()
          .withDefaultTransactionType()
          .withSync(ShieldedV1.Sync.makeSimulatorSyncService, ShieldedV1.Sync.makeSimulatorSyncCapability)
          .withSerializationDefaults()
          .withTransactingDefaults()
          .withCoinsAndBalancesDefaults()
          .withTransactionHistory(ShieldedV1.TransactionHistory.makeSimulatorTransactionHistoryService)
          .withKeysDefaults()
          .withStartAuxDefaults()
          .withCoinSelectionDefaults(),
        configuration: {
          networkId: NETWORK_ID,
          simulator: v8Chain,
          txHistoryStorage: new NoOpTransactionHistoryStorage<WalletEntry>(),
          indexerClientConnection: UNUSED_INDEXER,
        },
      },
      {
        builder: new ShieldedV2.V2Builder()
          .withDefaultTransactionType()
          .withSync(ShieldedV2.Sync.makeSimulatorSyncService, ShieldedV2.Sync.makeSimulatorSyncCapability)
          .withSerializationDefaults()
          .withTransactingDefaults()
          .withCoinsAndBalancesDefaults()
          .withTransactionHistory(ShieldedV2.TransactionHistory.makeSimulatorTransactionHistoryService)
          .withKeysDefaults()
          .withStartAuxDefaults()
          .withCoinSelectionDefaults()
          .withMigration(() => ShieldedV2.Migration.makeCrossLedgerMigration()),
        configuration: {
          networkId: NETWORK_ID,
          simulator: v9Chain,
          txHistoryStorage: new NoOpTransactionHistoryStorage<WalletEntry>(),
          indexerClientConnection: UNUSED_INDEXER,
        },
      },
    );

    const DustWallet = CustomForkingDustWallet(
      forkingConfiguration,
      {
        builder: new DustV1.V1Builder()
          .withDefaultTransactionType()
          .withSync(DustV1.SyncService.makeSimulatorSyncService, DustV1.SyncService.makeSimulatorSyncCapability)
          .withSerializationDefaults()
          .withTransactingDefaults()
          .withCoinsAndBalancesDefaults()
          .withTransactionHistory(DustV1.TransactionHistory.makeSimulatorTransactionHistoryService)
          .withKeysDefaults()
          .withStartAuxDefaults()
          .withCoinSelectionDefaults(),
        configuration: {
          networkId: NETWORK_ID,
          costParameters: { feeBlocksMargin: 0 },
          dustParameters: v8DustParameters,
          simulator: v8Chain,
          txHistoryStorage: new NoOpTransactionHistoryStorage<WalletEntry>(),
          indexerClientConnection: UNUSED_INDEXER,
        },
      },
      {
        builder: new DustV2.V2Builder()
          .withDefaultTransactionType()
          .withSync(DustV2.SyncService.makeSimulatorSyncService, DustV2.SyncService.makeSimulatorSyncCapability)
          .withSerializationDefaults()
          .withTransactingDefaults()
          .withCoinsAndBalancesDefaults()
          .withTransactionHistory(DustV2.TransactionHistory.makeSimulatorTransactionHistoryService)
          .withKeysDefaults()
          .withStartAuxDefaults()
          .withCoinSelectionDefaults()
          .withMigration(() => DustV2.Migration.makeCrossLedgerMigration({ dustParameters: v9DustParameters })),
        configuration: {
          networkId: NETWORK_ID,
          costParameters: { feeBlocksMargin: 0 },
          dustParameters: v9DustParameters,
          simulator: v9Chain,
          txHistoryStorage: new NoOpTransactionHistoryStorage<WalletEntry>(),
          indexerClientConnection: UNUSED_INDEXER,
        },
      },
    );

    const UnshieldedWallet = CustomForkingUnshieldedWallet(
      forkingConfiguration,
      {
        builder: new UnshieldedV1.V1Builder()
          .withSync(UnshieldedV1.Sync.makeSimulatorSyncService, UnshieldedV1.Sync.makeSimulatorSyncCapability)
          .withSerializationDefaults()
          .withTransactingDefaults()
          .withSigningDefaults()
          .withCoinsAndBalancesDefaults()
          .withKeysDefaults()
          .withCoinSelectionDefaults()
          .withTransactionHistoryDefaults()
          .withMigration(() => UnshieldedV1.Migration.makeEmptyWalletMigration({ networkId: NETWORK_ID })),
        configuration: {
          networkId: NETWORK_ID,
          simulator: v8Chain,
          txHistoryStorage: new NoOpTransactionHistoryStorage<WalletEntry>(),
        },
      },
      {
        builder: new UnshieldedV2.V2Builder()
          .withSync(UnshieldedV2.Sync.makeSimulatorSyncService, UnshieldedV2.Sync.makeSimulatorSyncCapability)
          .withSerializationDefaults()
          .withTransactingDefaults()
          .withSigningDefaults()
          .withCoinsAndBalancesDefaults()
          .withKeysDefaults()
          .withCoinSelectionDefaults()
          .withTransactionHistoryDefaults()
          .withMigration(() => UnshieldedV2.Migration.makeCrossLedgerMigration()),
        configuration: {
          networkId: NETWORK_ID,
          simulator: v9Chain,
          txHistoryStorage: new NoOpTransactionHistoryStorage<WalletEntry>(),
        },
      },
    );

    // Each snapshot is written by a wallet of the same composition, on the V1 variant a wallet with no history below
    // the boundary is on; restoring it is what leaves the wallet keyless.
    const shieldedSnapshot = yield* Effect.promise(async () => {
      const writer = await ShieldedWallet.startWithSeed(seeds.shielded);
      const snapshot = await writer.serializeState();
      await writer.stop();
      return snapshot;
    });
    const dustSnapshot = yield* Effect.promise(async () => {
      const writer = await DustWallet.startWithSeed(seeds.dust, v9DustParameters);
      const snapshot = await writer.serializeState();
      await writer.stop();
      return snapshot;
    });
    const shielded = ShieldedWallet.restore(shieldedSnapshot);
    const dust = DustWallet.restore(dustSnapshot);

    const keystore = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, NETWORK_ID);
    const unshielded = yield* Effect.promise(() =>
      UnshieldedWallet.startWithPublicKey(PublicKey.fromKeyStore(keystore)),
    );

    return yield* Effect.acquireRelease(
      Effect.promise(() =>
        WalletFacade.init({
          configuration: {
            networkId: NETWORK_ID,
            forks: { v9: forkVersion },
            // Unused: every wallet here syncs from a simulator, and nothing is proved or submitted.
            relayURL: new URL('http://unused:0'),
            indexerClientConnection: UNUSED_INDEXER,
            provingServerUrl: new URL('http://unused:0'),
            costParameters: { feeBlocksMargin: 0 },
            txHistoryStorage: new NoOpTransactionHistoryStorage<WalletEntry>(),
          },
          shielded: () => shielded,
          unshielded: () => unshielded,
          dust: () => dust,
          provingService: () => createV8MockProvingService(),
          pendingTransactionsService: () => pendingTransactions,
        }),
      ),
      (facade) => Effect.promise(() => facade.stop()),
    );
  });

/** A pending service that records each time it is started, so a test can tell a first start from a second. */
class StartRecordingPendingTransactions extends SilentPendingTransactions {
  readonly starts: null[] = [];

  override start(): Promise<void> {
    this.starts.push(null);
    return Promise.resolve();
  }
}

/** What a facade call rejected with, exactly as a caller catches it, or `undefined` if it resolved. */
const rejectionOf = (call: Promise<unknown>): Effect.Effect<unknown> =>
  Effect.promise(() =>
    call.then(
      () => undefined,
      (rejection: unknown) => rejection,
    ),
  );

/** The protocol version the facade reads off its dust wallet before anything has been started. */
const dustVersionOf = (facade: WalletFacade) =>
  Effect.promise(() => rx.firstValueFrom(facade.state())).pipe(Effect.map((state) => state.protocolVersion.dust));

/** Starts the facade from `material`, and waits until all three wallets have caught up with the ledger-v8 chain. */
const startAndSync = (facade: WalletFacade, material: FacadeStartMaterial) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => facade.start(material));
    return yield* Effect.promise(() => rx.firstValueFrom(facade.state().pipe(rx.filter((state) => state.isSynced))));
  });

describe('A facade started over wallets restored below forks.v9', () => {
  const seeds = WalletSeeds.fromMasterSeed(MASTER_SEED);

  it('resumes them from seeds, which derive the ledger-v8 keys their V1 variants run on', () =>
    Effect.gen(function* () {
      const facade = yield* facadeOverRestoredWallets(seeds);

      const synced = yield* startAndSync(facade, seeds);

      expect(synced.activeProtocolVersion).toBeLessThan(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('resumes them from both ledger versions’ key objects, using the ledger-v8 side for the V1 variants', () =>
    Effect.gen(function* () {
      const facade = yield* facadeOverRestoredWallets(seeds);

      const synced = yield* startAndSync(facade, {
        v8: {
          shielded: ledgerV8.ZswapSecretKeys.fromSeed(seeds.shielded),
          dust: ledgerV8.DustSecretKey.fromSeed(seeds.dust),
        },
        v9: {
          shielded: ledgerV9.ZswapSecretKeys.fromSeed(seeds.shielded),
          dust: ledgerV9.DustSecretKey.fromSeed(seeds.dust),
        },
      });

      expect(synced.activeProtocolVersion).toBeLessThan(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('A facade asked to synchronize by hand over wallets restored below forks.v9', () => {
  const seeds = WalletSeeds.fromMasterSeed(MASTER_SEED);

  it('refuses manualSync in start(), before starting anything', () =>
    Effect.gen(function* () {
      const pendingTransactions = new StartRecordingPendingTransactions();
      const facade = yield* facadeOverRestoredWallets(seeds, pendingTransactions);
      const dustVersion = yield* dustVersionOf(facade);
      expect(dustVersion).toBeLessThan(forkVersion);

      const rejection = yield* rejectionOf(facade.start(seeds, { manualSync: true }));

      expect(rejection).toBeInstanceOf(ManualSyncUnsupportedError);
      expect(rejection).toMatchObject({ protocolVersion: dustVersion });
      expect(pendingTransactions.starts).toHaveLength(0);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('resumes them in the background when started again without it, each service started once', () =>
    Effect.gen(function* () {
      const pendingTransactions = new StartRecordingPendingTransactions();
      const facade = yield* facadeOverRestoredWallets(seeds, pendingTransactions);
      yield* rejectionOf(facade.start(seeds, { manualSync: true }));

      const synced = yield* startAndSync(facade, seeds);

      expect(synced.activeProtocolVersion).toBeLessThan(forkVersion);
      expect(pendingTransactions.starts).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('refuses doSync with the error itself, not a wrapper around it', () =>
    Effect.gen(function* () {
      const facade = yield* facadeOverRestoredWallets(seeds);
      const dustVersion = yield* dustVersionOf(facade);

      const rejection = yield* rejectionOf(facade.doSync(seeds));

      expect(rejection).toBeInstanceOf(ManualSyncUnsupportedError);
      expect(rejection).toMatchObject({ protocolVersion: dustVersion });
    }).pipe(Effect.scoped, Effect.runPromise));
});
