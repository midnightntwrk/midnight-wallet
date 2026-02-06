// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { firstValueFrom } from 'rxjs';
import { logger } from './logger.js';
import { type TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import { getShieldedSeed, waitForSyncFacade } from './utils.js';
import * as allure from 'allure-js-commons';
import { ShieldedWallet, type ShieldedWalletClass } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  type UnshieldedKeystore,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '../../../dust-wallet/dist/DustWallet.js';

/**
 * Syncing tests
 *
 * @group undeployed
 */

describe('Syncing', () => {
  const getFixture = useTestContainersFixture();
  const timeout = 600_000;
  const seeds = [
    getShieldedSeed('0000000000000000000000000000000000000000000000000000000000000001'),
    getShieldedSeed('b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82'),
    getShieldedSeed('0000000000000000000000000000000000000000000000000000000000000001'),
    getShieldedSeed('0000000000000000000000000000000000000000000000000000000000000000'),
  ];

  let Wallet: ShieldedWalletClass;
  const shieldedWallets: Array<ShieldedWallet> = [];
  const unshieldedWallets: Array<UnshieldedWallet> = [];
  const dustWallets: Array<DustWallet> = [];
  const unshieldedKeystores: Array<UnshieldedKeystore> = [];
  const facades: Array<WalletFacade> = [];
  let fixture: TestContainersFixture;
  const rawNativeTokenType = (ledger.nativeToken() as { tag: string; raw: string }).raw;

  beforeEach(async () => {
    await allure.step('Start multiple wallets', async function () {
      fixture = getFixture();
      Wallet = ShieldedWallet(fixture.getWalletConfig());
      const Dust = DustWallet({ ...fixture.getWalletConfig(), ...fixture.getDustWalletConfig() });
      const dustParameters = ledger.LedgerParameters.initialParameters().dust;

      async function buildWallets(seeds: Uint8Array<ArrayBufferLike>[]) {
        for (let i = 0; i < seeds.length; i++) {
          unshieldedKeystores[i] = createKeystore(seeds[i], fixture.getNetworkId());
          shieldedWallets[i] = Wallet.startWithSeed(seeds[i]);
          dustWallets[i] = Dust.startWithSeed(seeds[i], dustParameters);
        }

        for (let i = 0; i < seeds.length; i++) {
          unshieldedWallets[i] = UnshieldedWallet({
            networkId: fixture.getNetworkId(),
            indexerClientConnection: {
              indexerHttpUrl: fixture.getIndexerUri(),
              indexerWsUrl: fixture.getIndexerWsUri(),
            },
            txHistoryStorage: new InMemoryTransactionHistoryStorage(),
          }).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystores[i]));
        }

        for (let i = 0; i < seeds.length; i++) {
          facades[i] = await WalletFacade.init({
            configuration: {
              ...fixture.getWalletConfig(),
              ...fixture.getDustWalletConfig(),
              txHistoryStorage: new InMemoryTransactionHistoryStorage(),
            },
            shielded: () => shieldedWallets[i],
            unshielded: () => unshieldedWallets[i],
            dust: () => dustWallets[i],
          });
          await facades[i].start(ledger.ZswapSecretKeys.fromSeed(seeds[i]), ledger.DustSecretKey.fromSeed(seeds[i]));
        }
      }

      await buildWallets(seeds);
    });
  }, timeout);

  afterEach(async () => {
    for (const facade of facades) {
      await facade.stop();
    }
  });

  test(
    'Syncing is working for multiple wallets concurrently',
    async () => {
      allure.tms('PM-10974', 'PM-10974');
      allure.epic('Headless wallet');
      allure.feature('Syncing');
      allure.story('Syncing wallets concurrently');

      const promises = facades.map((facade) => {
        return waitForSyncFacade(facade);
      });

      await Promise.all(promises);

      for (const facade of facades) {
        const index = facades.indexOf(facade);
        const syncedState = await firstValueFrom(facade.state());
        logger.info(`Wallet ${index}: ${syncedState.shielded.balances[rawNativeTokenType ?? 0n]}`);
        expect(syncedState.shielded.state.progress.isStrictlyComplete()).toBeTruthy();
        expect(syncedState.unshielded.progress.isStrictlyComplete()).toBeTruthy();
      }
    },
    timeout,
  );
});
