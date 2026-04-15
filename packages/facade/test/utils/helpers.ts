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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { type FacadeState, WalletFacade, type Clock } from '../../src/index.js';
import { CustomShieldedWallet, type ShieldedWalletAPI } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  Sync as ShieldedSync,
  TransactionHistory as ShieldedTransactionHistory,
  V1Builder as ShieldedV1Builder,
} from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { CustomDustWallet, type DustWalletAPI } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { SyncService as DustSyncService, V1Builder as DustV1Builder } from '@midnight-ntwrk/wallet-sdk-dust-wallet/v1';
import {
  CustomUnshieldedWallet,
  createKeystore,
  PublicKey,
  type UnshieldedWalletAPI,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { NoOpTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  Sync as UnshieldedSync,
  V1Builder as UnshieldedV1Builder,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet/v1';
import { type NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as Submission from '@midnight-ntwrk/wallet-sdk-capabilities/submission';
import {
  makeSimulatorProvingServiceEffect,
  type ProvingService,
  type UnboundTransaction,
} from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import { type Simulator } from '@midnight-ntwrk/wallet-sdk-capabilities/simulation';
import type { SubmissionService } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { Effect, type Scope } from 'effect';
import * as rx from 'rxjs';

export const getShieldedSeed = (seed: string): Uint8Array => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.Zswap).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }

  return Buffer.from(derivationResult.key);
};

export const getUnshieldedSeed = (seed: string): Uint8Array<ArrayBufferLike> => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }

  return derivationResult.key;
};

export const getDustSeed = (seed: string): Uint8Array<ArrayBufferLike> => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.Dust).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }

  return derivationResult.key;
};

export const tokenValue = (value: bigint): bigint => value * 10n ** 6n;

export const waitForFullySynced = async (facade: WalletFacade): Promise<FacadeState> => {
  return await rx.firstValueFrom(facade.state().pipe(rx.filter((s) => s.isSynced)));
};

export const sleep = (secs: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, secs * 1000));
};

// we need to wait for at least one block for Dust to be generated
export const waitForDustGenerated = (seconds: number = 10): Promise<void> => sleep(seconds);

/**
 * Creates a clock backed by the simulator's current time.
 * Reads time synchronously from the simulator's state ref.
 */
export const simulatorClock = (simulator: Simulator): Clock => ({
  now: () => Effect.runSync(simulator.query((s) => s.currentTime)),
});

// =============================================================================
// Simulation Mode Helpers
// =============================================================================

/**
 * Configuration for simulator-based testing.
 */
export type SimulatorConfig = {
  simulator: Simulator;
  networkId: NetworkId.NetworkId;
  costParameters: { feeBlocksMargin: number };
};

/**
 * Creates a Promise-based wrapper around the Effect-based simulator proving service.
 * Note: Uses type assertion because simulator proving returns ProofErasedTransaction
 * but facade expects UnboundTransaction - they are compatible at runtime.
 */
export const createSimulatorProvingService = (): ProvingService<UnboundTransaction> => {
  const effectService = makeSimulatorProvingServiceEffect();
  return {
    prove: (tx: ledger.UnprovenTransaction) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return
      effectService.prove(tx).pipe(Effect.runPromise) as any,
  };
};

/**
 * Creates a Promise-based wrapper around the Effect-based simulator submission service.
 * Note: Uses type assertions because simulator uses different transaction types internally.
 */
export const createSimulatorSubmissionService = (
  simulator: Simulator,
): SubmissionService<ledger.FinalizedTransaction> => {
  const effectService = Submission.makeSimulatorSubmissionService<ledger.FinalizedTransaction>('InBlock')({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    simulator: simulator as any,
  });
  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    submitTransaction: ((tx: ledger.FinalizedTransaction, waitFor?: 'Submitted' | 'InBlock' | 'Finalized') =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      effectService.submitTransaction(tx, waitFor ?? 'InBlock').pipe(Effect.runPromise)) as any,
    close: () => effectService.close().pipe(Effect.runPromise),
  };
};

/**
 * Wallet factory type for simulation mode.
 */
export type SimulatorWalletFactories = {
  createShieldedWallet: (keys: ledger.ZswapSecretKeys) => ShieldedWalletAPI;
  createDustWallet: (key: ledger.DustSecretKey, params: ledger.DustParameters) => DustWalletAPI;
  createUnshieldedWallet: (keystore: ReturnType<typeof createKeystore>) => UnshieldedWalletAPI;
};

/**
 * Creates wallet factory functions for simulation mode.
 *
 * Uses default capabilities for everything except sync (which uses simulator).
 * This ensures transacting and other capabilities match real-network behavior,
 * with only sync differing for simulator.
 *
 * Note: We cannot use `.withDefaults().withSync(...)` pattern because `withDefaults()`
 * adds `DefaultSyncConfiguration` to the required config type (including `indexerClientConnection`),
 * and even though we override the sync implementation, TypeScript still requires those config
 * properties. Instead, we explicitly chain all the individual `.with*Defaults()` methods,
 * substituting `.withSync(...)` for `.withSyncDefaults()`.
 */
export const createSimulatorWalletFactories = (config: SimulatorConfig): SimulatorWalletFactories => {
  // Shielded wallet: all defaults except sync and transaction history (uses simulator variants)
  const ShieldedWalletFactory = CustomShieldedWallet(
    {
      ...config,
      txHistoryStorage: new NoOpTransactionHistoryStorage(),
      indexerClientConnection: { indexerHttpUrl: 'http://unused:0' },
    },
    new ShieldedV1Builder()
      .withDefaultTransactionType()
      .withSync(ShieldedSync.makeSimulatorSyncService, ShieldedSync.makeSimulatorSyncCapability)
      .withSerializationDefaults()
      .withTransactingDefaults()
      .withCoinsAndBalancesDefaults()
      .withTransactionHistory(ShieldedTransactionHistory.makeSimulatorTransactionHistoryService)
      .withKeysDefaults()
      .withCoinSelectionDefaults(),
  );

  // Dust wallet: all defaults except sync (uses simulator sync)
  const DustWalletFactory = CustomDustWallet(
    config,
    new DustV1Builder()
      .withDefaultTransactionType()
      .withSync(DustSyncService.makeSimulatorSyncService, DustSyncService.makeSimulatorSyncCapability)
      .withSerializationDefaults()
      .withTransactingDefaults()
      .withCoinsAndBalancesDefaults()
      .withKeysDefaults()
      .withCoinSelectionDefaults(),
  );

  // Unshielded wallet: all defaults except sync (uses simulator sync)
  const UnshieldedWalletFactory = CustomUnshieldedWallet(
    { ...config, txHistoryStorage: new NoOpTransactionHistoryStorage() },
    new UnshieldedV1Builder()
      .withSync(UnshieldedSync.makeSimulatorSyncService, UnshieldedSync.makeSimulatorSyncCapability)
      .withSerializationDefaults()
      .withTransactingDefaults()
      .withCoinsAndBalancesDefaults()
      .withKeysDefaults()
      .withCoinSelectionDefaults()
      .withTransactionHistoryDefaults(),
  );

  return {
    createShieldedWallet: (keys) => ShieldedWalletFactory.startWithSecretKeys(keys) as unknown as ShieldedWalletAPI,
    createDustWallet: (key, params) => DustWalletFactory.startWithSecretKey(key, params) as unknown as DustWalletAPI,
    createUnshieldedWallet: (keystore) =>
      UnshieldedWalletFactory.startWithPublicKey(PublicKey.fromKeyStore(keystore)) as unknown as UnshieldedWalletAPI,
  };
};

/**
 * Keys derived from a seed for wallet initialization.
 */
export type WalletKeys = {
  shieldedKeys: ledger.ZswapSecretKeys;
  dustKey: ledger.DustSecretKey;
  unshieldedKeystore: ReturnType<typeof createKeystore>;
  signatureVerifyingKey: ledger.SignatureVerifyingKey;
  userAddress: ledger.UserAddress;
};

/**
 * Derives all wallet keys from a hex seed.
 */
export const deriveWalletKeys = (hexSeed: string, networkId: NetworkId.NetworkId): WalletKeys => {
  const shieldedSeed = getShieldedSeed(hexSeed);
  const dustSeed = getDustSeed(hexSeed);
  const unshieldedSeed = getUnshieldedSeed(hexSeed);

  const shieldedKeys = ledger.ZswapSecretKeys.fromSeed(shieldedSeed);
  const dustKey = ledger.DustSecretKey.fromSeed(dustSeed);
  const unshieldedKeystore = createKeystore(unshieldedSeed, networkId);
  const signatureVerifyingKey = ledger.signatureVerifyingKey(Buffer.from(unshieldedSeed).toString('hex'));
  const userAddress = ledger.addressFromKey(signatureVerifyingKey);

  return { shieldedKeys, dustKey, unshieldedKeystore, signatureVerifyingKey, userAddress };
};

/**
 * Creates and initializes a WalletFacade for simulation mode.
 * Returns an Effect that acquires the facade and releases it on scope close.
 *
 * Proving and submission services are created internally from the simulator config.
 */
export const makeSimulatorFacade = (
  config: SimulatorConfig,
  keys: WalletKeys,
  factories: SimulatorWalletFactories,
): Effect.Effect<WalletFacade, never, Scope.Scope> => {
  const dustParameters = ledger.LedgerParameters.initialParameters().dust;
  const provingService = createSimulatorProvingService();
  const submissionService = createSimulatorSubmissionService(config.simulator);

  return Effect.acquireRelease(
    Effect.promise(async () => {
      const facade = await WalletFacade.init({
        configuration: {
          ...config,
          // Dummy values - not used in simulation mode
          indexerClientConnection: { indexerHttpUrl: 'http://unused' },
          relayURL: new URL('ws://unused'),
          txHistoryStorage: new NoOpTransactionHistoryStorage(),
        },
        shielded: () => factories.createShieldedWallet(keys.shieldedKeys),
        unshielded: () => factories.createUnshieldedWallet(keys.unshieldedKeystore),
        dust: () => factories.createDustWallet(keys.dustKey, dustParameters),
        provingService: () => provingService,
        submissionService: () => submissionService,
        clock: () => simulatorClock(config.simulator),
      });

      // Start the wallet with keys
      await facade.start(keys.shieldedKeys, keys.dustKey);

      return facade;
    }),
    // Release: stop the facade when scope closes
    (facade) => Effect.promise(() => facade.stop()),
  );
};

/**
 * Wait for a facade's shielded wallet to have available coins.
 */
export const waitForShieldedCoins = (facade: WalletFacade): Effect.Effect<void> =>
  Effect.promise(() =>
    rx.firstValueFrom(facade.state().pipe(rx.filter((s) => s.shielded.availableCoins.length > 0))),
  ).pipe(Effect.asVoid);

/**
 * Wait for a facade's unshielded wallet to have a specific balance.
 */
export const waitForUnshieldedBalance = (
  facade: WalletFacade,
  tokenType: string,
  minBalance: bigint,
): Effect.Effect<bigint> =>
  Effect.promise(() =>
    rx.firstValueFrom(
      facade.state().pipe(
        rx.map((s) => s.unshielded.balances[tokenType] ?? 0n),
        rx.filter((balance) => balance >= minBalance),
      ),
    ),
  );
