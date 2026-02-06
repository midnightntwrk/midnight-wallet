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
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { describe, test, expect } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { ShieldedWallet, ShieldedWalletClass } from '@midnight-ntwrk/wallet-sdk-shielded';
import * as KeyManagement from '@cardano-sdk/key-management';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as utils from './utils.js';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as allure from 'allure-js-commons';
import {
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet, DustWalletClass } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { logger } from './logger.js';
import { DustAddress, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { inspect } from 'node:util';

/**
 * Tests using an empty wallet
 *
 * @group undeployed
 * @group devnet
 * @group testnet
 */
describe('Fresh wallet with empty state', () => {
  const getFixture = useTestContainersFixture();
  const walletSeed = '0000000000000000000000000000000000000000000000000000000000000009';
  const walletSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(walletSeed));
  const dustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(walletSeed));
  const timeout = 120_000;

  let Wallet: ShieldedWalletClass;
  let Dust: DustWalletClass;
  let shieldedWallet: ShieldedWallet;
  let wallet: utils.WalletInit;
  let networkId: NetworkId.NetworkId;
  let fixture: TestContainersFixture;

  beforeEach(async () => {
    await allure.step('Start a fresh wallet', async function () {
      fixture = getFixture();
      networkId = fixture.getNetworkId();
      logger.info(`Network id: ${networkId}`);
      expect(fixture).toBeDefined();

      Dust = DustWallet({ ...fixture.getWalletConfig(), ...fixture.getDustWalletConfig() });
      Wallet = ShieldedWallet(fixture.getWalletConfig());
      shieldedWallet = Wallet.startWithSecretKeys(walletSecretKey);
      wallet = await utils.initWalletWithSeed(walletSeed, fixture);
    });
  });

  afterEach(async () => {
    await wallet.wallet.stop();
  });

  test('Valid Midnight wallet can be built from a BIP32 compatible mnemonic seed phrase', () => {
    allure.tag('smoke');
    allure.tms('PM-8914', 'PM-8914');
    allure.epic('Headless wallet');
    allure.feature('Build wallet');
    allure.story('Midnight wallet can be built from a BIP32 mnemonic seed phrase seed phrase');
    const mnemonics = [
      'result',
      'off',
      'neither',
      'clap',
      'shallow',
      'betray',
      'sphere',
      'festival',
      'beauty',
      'million',
      'network',
      'bring',
      'field',
      'message',
      'rose',
      'resist',
      'volume',
      'road',
      'other',
      'join',
      'label',
      'scorpion',
      'claw',
      'economy',
    ];

    const entropy = Buffer.from(KeyManagement.util.mnemonicWordsToEntropy(mnemonics), 'hex');
    try {
      Wallet.startWithSeed(entropy);
      // If we reach here, no error was thrown
      expect(true).toBe(true);
    } catch (error) {
      // If we reach here, an error was thrown when it shouldn't have
      expect(error).toBeUndefined();
    }

    try {
      UnshieldedWallet({
        networkId: fixture.getNetworkId(),
        indexerClientConnection: {
          indexerHttpUrl: fixture.getIndexerUri(),
          indexerWsUrl: fixture.getIndexerWsUri(),
        },
        txHistoryStorage: new InMemoryTransactionHistoryStorage(),
      }).startWithPublicKey(PublicKey.fromKeyStore(wallet.unshieldedKeystore));
    } catch (error) {
      expect(error).toBeUndefined();
    }
  });

  test('Unable to start wallet with invalid seed', () => {
    const shortSeed = Buffer.from('12345', 'hex');
    expect(() => Wallet.startWithSeed(shortSeed)).toThrowError('Expected 32-byte seed');
    const invalidSeed = Buffer.from('"000000000000000000000000000000000000000000000000000000000000009', 'hex');
    expect(() => Wallet.startWithSeed(invalidSeed)).toThrowError('Expected 32-byte seed');
  });

  test(
    'Shielded wallet state can be serialized and then restored',
    async () => {
      allure.tms('PM-9084', 'PM-9084');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - serialize');
      const initialState = await shieldedWallet.waitForSyncedState();
      const serialized = await shieldedWallet.serializeState();
      const stateObject = JSON.parse(serialized);
      expect(Number(stateObject.offset)).toBeGreaterThanOrEqual(0);
      expect(stateObject.state).toBeTruthy();

      const restoredWallet = Wallet.restore(serialized);
      const newState = await firstValueFrom(restoredWallet.state);
      expect(newState.address.equals(initialState.address)).toEqual(true);
      // compareStates(newState, state);
      // expect(state.syncProgress?.lag?.applyGap).toBeLessThanOrEqual(newState.syncProgress?.lag?.applyGap ?? 0);
      // expect(state.syncProgress?.lag?.sourceGap).toBeLessThanOrEqual(newState.syncProgress?.lag?.sourceGap ?? 0);
      await restoredWallet.stop();
    },
    timeout,
  );

  test(
    'Unshielded wallet state can be serialized and then restored',
    async () => {
      allure.tms('PM-9084', 'PM-9084');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - serialize');
      const walletState = await firstValueFrom(wallet.wallet.unshielded.state);
      const walletAddress = UnshieldedAddress.codec.encode(fixture.getNetworkId(), walletState.address).asString();
      const serialized = await wallet.wallet.unshielded.serializeState();
      const stateObject = JSON.parse(serialized);
      logger.info(`Serialized unshielded wallet state: ${inspect(stateObject)}`);
      expect(stateObject.publicKey.publicKey).toHaveLength(64);
      expect(stateObject.publicKey.addressHex).toHaveLength(64);
      const restoredWallet = UnshieldedWallet({
        networkId: fixture.getNetworkId(),
        indexerClientConnection: {
          indexerHttpUrl: fixture.getIndexerUri(),
          indexerWsUrl: fixture.getIndexerWsUri(),
        },
        txHistoryStorage: new InMemoryTransactionHistoryStorage(),
      }).restore(serialized);
      const newState = await firstValueFrom(restoredWallet.state);
      expect(UnshieldedAddress.codec.encode(fixture.getNetworkId(), newState.address).asString()).toBe(walletAddress);
      await restoredWallet.stop();
    },
    timeout,
  );

  test(
    'Dust wallet state can be serialized and then restored',
    async () => {
      allure.tms('PM-9084', 'PM-9084');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - serialize');
      const state = await utils.waitForSyncFacade(wallet.wallet);
      const publicKey = state.dust.publicKey;
      const address = state.dust.address;
      const serialized = await wallet.wallet.dust.serializeState();
      const stateObject = await JSON.parse(serialized);
      expect(stateObject.publicKey.publicKey).toContain(publicKey);
      expect(stateObject.state).toBeTruthy();
      expect(stateObject.networkId).toBe(networkId);

      const restoredWallet = Dust.restore(serialized);
      await restoredWallet.start(dustSecretKey);
      const restoredState = await firstValueFrom(restoredWallet.state);
      expect(publicKey).toBe(restoredState.publicKey);
      expect(address.equals(restoredState.address)).toEqual(true);
    },
    timeout,
  );

  test('Shielded wallet state returns coinPublicKey hex string', async () => {
    allure.tms('PM-8920', 'PM-8920');
    allure.epic('Headless wallet');
    allure.feature('Wallet state');
    allure.story('Wallet state properties - fresh');
    const state = await firstValueFrom(wallet.wallet.shielded.state);
    expect(state.address.coinPublicKeyString()).toMatch(/^[0-9a-f]{64}$/);
  });

  test('Shielded wallet state returns encryptionPublicKey hex string', async () => {
    allure.tms('PM-8921', 'PM-8921');
    allure.epic('Headless wallet');
    allure.feature('Wallet state');
    allure.story('Wallet state properties - fresh');
    const state = await firstValueFrom(wallet.wallet.shielded.state);
    expect(state.address.encryptionPublicKeyString()).toMatch(/^[0-9a-f]{64}$/);
  });

  test(
    'Shielded midnight wallet returns empty object of balances',
    async () => {
      allure.tms('PM-8923', 'PM-8923');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - fresh');
      const state = await firstValueFrom(wallet.wallet.shielded.state);
      expect(state.balances).toMatchObject({});
    },
    timeout,
  );

  test(
    'Shielded midnight wallet returns no coins',
    async () => {
      allure.tms('PM-8924', 'PM-8924');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - fresh');
      const state = await firstValueFrom(wallet.wallet.shielded.state);
      expect(state.totalCoins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Shielded midnight wallet returns no available coins',
    async () => {
      allure.tms('PM-8925', 'PM-8925');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - fresh');
      const state = await firstValueFrom(wallet.wallet.shielded.state);
      expect(state.availableCoins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Shielded midnight wallet returns no pending coins',
    async () => {
      allure.tms('PM-8926', 'PM-8926');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - fresh');
      const state = await firstValueFrom(wallet.wallet.shielded.state);
      expect(state.pendingCoins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Shielded midnight wallet returns no tx history',
    async () => {
      allure.tms('PM-8927', 'PM-8927');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - fresh');
      const state = await firstValueFrom(wallet.wallet.shielded.state);
      expect(() => state.transactionHistory).toThrow();
    },
    timeout,
  );

  test(
    'Shielded midnight wallet returns coin public key',
    async () => {
      allure.tms('PM-15112', 'PM-15112');
      allure.epic('Headless wallet');
      allure.feature('Wallet state - Bech32m');
      allure.story('Wallet returns Bech32m coin public key');
      const state = await firstValueFrom(wallet.wallet.shielded.state);
      expect(state.address.coinPublicKeyString()).toMatch(/^[0-9a-f]{64}$/);
    },
    timeout,
  );

  test(
    'Shielded midnight wallet returns encryption public key',
    async () => {
      allure.tms('PM-15106', 'PM-15106');
      allure.epic('Headless wallet');
      allure.feature('Wallet state - Bech32m');
      allure.story('Wallet returns Bech32m encryption public key');
      const state = await firstValueFrom(wallet.wallet.shielded.state);
      expect(state.address.encryptionPublicKeyString()).toMatch(/^[0-9a-f]{64}$/);
    },
    timeout,
  );

  test(
    'Unshielded midnight wallet returns valid bech32 public coin address',
    async () => {
      allure.tms('PM-15106', 'PM-15106');
      allure.epic('Headless wallet');
      allure.feature('Wallet state - Bech32m');
      allure.story('Wallet returns Bech32m encryption public key');
      const walletState = await firstValueFrom(wallet.wallet.unshielded.state);
      expect(walletState.address).toBeTruthy();
      utils.validateNetworkInAddress(
        UnshieldedAddress.codec.encode(fixture.getNetworkId(), walletState.address).asString(),
      ); // probably not needed anymore
    },
    timeout,
  );

  test(
    'Unshielded midnight wallet returns returns no available coins',
    async () => {
      allure.tms('PM-15106', 'PM-15106');
      allure.epic('Headless wallet');
      allure.feature('Wallet state - Bech32m');
      allure.story('Wallet returns Bech32m encryption public key');
      const walletState = await firstValueFrom(wallet.wallet.unshielded.state);
      expect(walletState.availableCoins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Unshielded midnight wallet returns returns no balances',
    async () => {
      allure.tms('PM-15106', 'PM-15106');
      allure.epic('Headless wallet');
      allure.feature('Wallet state - Bech32m');
      allure.story('Wallet returns Bech32m encryption public key');
      const walletState = await firstValueFrom(wallet.wallet.unshielded.state);
      expect(walletState.balances).toStrictEqual({});
    },
    timeout,
  );

  test(
    'Unshielded midnight wallet returns returns no pending coins',
    async () => {
      allure.tms('PM-15106', 'PM-15106');
      allure.epic('Headless wallet');
      allure.feature('Wallet state - Bech32m');
      allure.story('Wallet returns Bech32m encryption public key');
      const walletState = await firstValueFrom(wallet.wallet.unshielded.state);
      expect(walletState.pendingCoins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Unshielded midnight wallet returns returns no total coins',
    async () => {
      allure.tms('PM-15106', 'PM-15106');
      allure.epic('Headless wallet');
      allure.feature('Wallet state - Bech32m');
      allure.story('Wallet returns Bech32m encryption public key');
      const walletState = await firstValueFrom(wallet.wallet.unshielded.state);
      expect(walletState.totalCoins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Dust wallet returns empty balance',
    async () => {
      const walletState = await firstValueFrom(wallet.wallet.dust.state);
      expect(walletState.balance(new Date())).toBe(0n);
    },
    timeout,
  );

  test(
    'Dust wallet returns valid public key',
    async () => {
      const walletState = await firstValueFrom(wallet.wallet.dust.state);
      const publicKey = walletState.publicKey;
      expect(publicKey).toBeTruthy();
      expect(publicKey).toBeTypeOf('bigint');
    },
    timeout,
  );

  test(
    'Dust wallet returns valid address',
    async () => {
      // allure.tms('PM-15106', 'PM-15106');
      // allure.epic('Headless wallet');
      // allure.feature('Wallet state - Bech32m');
      // allure.story('Wallet returns Bech32m encryption public key');
      const walletState = await firstValueFrom(wallet.wallet.dust.state);
      const dustAddress = walletState.address;
      expect(dustAddress).toBeInstanceOf(DustAddress);
    },
    timeout,
  );

  test(
    'Dust wallet returns no available coins',
    async () => {
      const walletState = await firstValueFrom(wallet.wallet.dust.state);
      expect(walletState.availableCoins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Dust wallet returns no total coins',
    async () => {
      const walletState = await firstValueFrom(wallet.wallet.dust.state);
      expect(walletState.totalCoins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Dust wallet returns no pending coins',
    async () => {
      const walletState = await firstValueFrom(wallet.wallet.dust.state);
      expect(walletState.pendingCoins).toHaveLength(0);
    },
    timeout,
  );
});
