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
 *   Manual synchronization is the exception: it steps the dust wallet's projections sync, which only ledger-v9 has, so a
 *   facade asked to step a dust wallet still on its V1 variant must refuse rather than resolve having read nothing.
 *
 *   The shielded and dust wallets are the shipped forking compositions, each variant syncing from a simulated chain of
 *   its own ledger version; the chain they read is a ledger-v8 one that never reaches the boundary.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { NetworkId, NoOpTransactionHistoryStorage, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Simulator, V8 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { CustomForkingDustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import * as DustV1 from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
import * as DustV2 from '@midnightntwrk/wallet-sdk-dust-wallet/v2';
import { WalletSeeds } from '@midnightntwrk/wallet-sdk-hd';
import { CustomForkingShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import * as ShieldedV1 from '@midnightntwrk/wallet-sdk-shielded/v1';
import * as ShieldedV2 from '@midnightntwrk/wallet-sdk-shielded/v2';
import { CustomForkingUnshieldedWallet, createKeystore, PublicKey } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import * as UnshieldedV1 from '@midnightntwrk/wallet-sdk-unshielded-wallet/v1';
import * as UnshieldedV2 from '@midnightntwrk/wallet-sdk-unshielded-wallet/v2';
import { Cause, Effect, Option, Runtime } from 'effect';
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
const facadeOverRestoredWallets = (seeds: WalletSeeds) =>
  Effect.gen(function* () {
    const v8Chain = yield* V8.Simulator.init({
      networkId: NETWORK_ID,
      protocolVersion: ProtocolVersion.MinSupportedVersion,
    });
    // The ledger-v9 variants are registered but never reached; their chain only has to exist.
    const v9Chain = yield* Simulator.init({ networkId: NETWORK_ID });
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
          pendingTransactionsService: () => new SilentPendingTransactions(),
        }),
      ),
      (facade) => Effect.promise(() => facade.stop()),
    );
  });

/**
 * The typed failure a facade call rejected with, or `None` if it resolved.
 *
 * @remarks
 *   The facade passes the wallets' rejections through, and those carry the effect cause rather than the error itself.
 */
const failureOf = (call: Promise<unknown>): Effect.Effect<Option.Option<unknown>> =>
  Effect.promise(() =>
    call.then(
      () => Option.none<unknown>(),
      (rejection: unknown) =>
        Runtime.isFiberFailure(rejection)
          ? Cause.failureOption(rejection[Runtime.FiberFailureCauseId])
          : Option.some(rejection),
    ),
  );

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

describe('A facade synchronized by hand over wallets restored below forks.v9', () => {
  const seeds = WalletSeeds.fromMasterSeed(MASTER_SEED);

  it('refuses to step the dust wallet, whose V1 variant only synchronizes in the background', () =>
    Effect.gen(function* () {
      const facade = yield* facadeOverRestoredWallets(seeds);
      yield* Effect.promise(() => facade.start(seeds, { manualSync: true }));

      const failure = yield* failureOf(facade.doSync(seeds));

      expect(Option.getOrUndefined(failure)).toMatchObject({
        _tag: '@midnightntwrk/wallet-sdk-dust-wallet/DustWallet/ManualSyncUnsupportedError',
      });
    }).pipe(Effect.scoped, Effect.runPromise));
});
