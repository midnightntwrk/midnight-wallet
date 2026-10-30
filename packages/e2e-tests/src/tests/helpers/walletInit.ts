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
import * as ledger from '@midnightntwrk/ledger-v9';
import { type WalletSeeds } from '@midnightntwrk/wallet-sdk-hd';
import { InMemoryTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { WalletFacade, WalletEntrySchema, mergeWalletEntries } from '@midnightntwrk/wallet-sdk-facade';
import {
  createKeystore,
  PublicKey,
  type UnshieldedKeystore,
  UnshieldedWallet,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import {
  type DustSnapshotModel,
  dustSyncModelOf,
  type DustWalletFactory,
  dustWalletFromEnv,
  makeEnvironment,
  type WalletTestEnvironment,
} from '@midnightntwrk/wallet-sdk-testkit/core';
import { Roles } from '@midnightntwrk/wallet-sdk-hd';
import { TestContainersFixture } from '../test-fixture.js';
import { getDustSeed, getShieldedSeed, getUnshieldedSeed } from './seeds.js';

/**
 * The testkit's view of this suite's fixture, so a suite that runs on the fixture's stack can use the testkit's
 * `provideWallet` and `saveState` without starting a second one.
 */
export const asWalletTestEnvironment = (fixture: TestContainersFixture): WalletTestEnvironment =>
  // No `down`: the fixture's own hooks tear its stack down, and the view must not do it a second time.
  makeEnvironment(TestContainersFixture.network, {
    networkId: fixture.getNetworkId(),
    proverUrl: fixture.getProverUri(),
    indexerHttpUrl: fixture.getIndexerUri(),
    indexerWsUrl: fixture.getIndexerWsUri(),
    nodeUrl: fixture.getNodeUri(),
  });

export type WalletInit = {
  /** The three per-wallet seeds, which is what the facade is started and stepped with. */
  seeds: WalletSeeds;
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
  /**
   * The dust sync model this wallet was actually built with, whether it came from an explicit option or from the
   * environment. The testkit's `saveState` reads it so a snapshot is always written to the namespace of the model that
   * produced it.
   */
  dustSyncModel: DustSnapshotModel;
};

export type CustomWallets = {
  /**
   * Replaces the dust sub-wallet factory. Defaults to whatever `DUST_SYNC` selects (the event-based sync when unset) —
   * see `dustWalletFromEnv` — so a lane can be switched between sync models by configuration while a test that needs a
   * specific model pins it here.
   *
   * @remarks
   *   `DustWalletFactory` is typed by what a start actually owes the facade rather than by `DustWalletClass`, so a
   *   single-variant composition is acceptable here — which is how the projections fast-sync is reached directly on a
   *   chain that runs ledger-v9 from its first block. See the type's own documentation in the testkit.
   */
  dustWallet?: DustWalletFactory;
  manualSync?: boolean;
};

export const initWalletWithSeed = async (
  seed: string,
  fixture: TestContainersFixture,
  // Unshielded signing scheme. Defaults to `schnorr` (legacy/default role) so
  // existing callers are unaffected; `ecdsa` derives under its own HD role.
  unshieldedScheme: ledger.SignatureKind = 'schnorr',
  customWallets: CustomWallets = {},
): Promise<WalletInit> => {
  const walletConfig = fixture.getWalletConfig();
  const seeds: WalletSeeds = {
    shielded: getShieldedSeed(seed),
    unshielded: getUnshieldedSeed(seed),
    dust: getDustSeed(seed),
  };
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(getShieldedSeed(seed));
  const dustSecretKey = ledger.DustSecretKey.fromSeed(getDustSeed(seed));
  const unshieldedKeystore = createKeystore(
    {
      kind: unshieldedScheme,
      secret: getUnshieldedSeed(seed, unshieldedScheme === 'ecdsa' ? Roles.EcdsaUnshielded : Roles.NightExternal),
    },
    fixture.getNetworkId(),
  );

  const dustWalletClass = customWallets?.dustWallet ?? dustWalletFromEnv();
  const manualSync = customWallets?.manualSync ?? false;

  const facade: WalletFacade = await WalletFacade.init({
    configuration: {
      ...walletConfig,
      ...fixture.getDustWalletConfig(),
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    },
    shielded: (config) => ShieldedWallet(config).startWithSeed(getShieldedSeed(seed)),
    unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (config) => dustWalletClass(config).startWithSeed(getDustSeed(seed)),
  });
  await facade.start(seeds, { manualSync });
  return {
    wallet: facade,
    shieldedSecretKeys,
    dustSecretKey,
    seeds,
    unshieldedKeystore,
    dustSyncModel: dustSyncModelOf(dustWalletClass),
  };
};
