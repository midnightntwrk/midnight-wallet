/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { firstValueFrom } from 'rxjs';
import { Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import * as KeyManagement from '@cardano-sdk/key-management';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture';
import { MidnightNetwork, closeWallet, compareStates, waitForSync } from './utils';
import { NetworkId } from '@midnight-ntwrk/zswap';
import { Wallet } from '@midnight-ntwrk/wallet-api';

/**
 * Tests using an empty wallet
 *
 * @group undeployed
 * @group devnet
 * @group testnet
 */

describe('Midnight wallet', () => {
  const getFixture = useTestContainersFixture();

  test('Valid Midnight wallet can be built from a BIP32 compatible mnemonic seed phrase', async () => {
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

    const entropy = KeyManagement.util.mnemonicWordsToEntropy(mnemonics);
    const fixture = getFixture();
    let networkId: NetworkId;
    switch (TestContainersFixture.network) {
      case 'undeployed':
        networkId = NetworkId.Undeployed;
        break;
      case 'devnet':
        networkId = NetworkId.DevNet;
        break;
      case 'testnet':
        networkId = NetworkId.TestNet;
        break;
    }

    await expect(
      WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        entropy,
        networkId,
        'info',
      ),
    ).resolves.not.toThrow();
  });
});

describe('Fresh wallet with empty state', () => {
  const getFixture = useTestContainersFixture();
  const seed = 'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82';
  const timeout = (process.env['NETWORK'] as MidnightNetwork) === 'devnet' ? 240_000 : 120_000;

  let wallet: Wallet & Resource;

  beforeEach(async () => {
    await allure.step('Start a fresh wallet', async function () {
      const fixture = getFixture();
      let networkId: NetworkId;
      switch (TestContainersFixture.network) {
        case 'undeployed':
          networkId = NetworkId.Undeployed;
          break;
        case 'devnet':
          networkId = NetworkId.DevNet;
          break;
        case 'testnet':
          networkId = NetworkId.TestNet;
          break;
      }

      wallet = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seed,
        networkId,
        'info',
      );
      wallet.start();
    });
  });

  afterEach(async () => {
    await closeWallet(wallet);
  });

  test(
    'Wallet state can be serialized and then restored',
    async () => {
      allure.tms('PM-9084', 'PM-9084');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - serialize');
      const fixture = getFixture();
      const state = await waitForSync(wallet);
      const serialized = await wallet.serializeState();
      const stateObject = JSON.parse(serialized);
      expect(stateObject.txHistory).toHaveLength(0);
      expect(stateObject.offset).toBeGreaterThan(0);
      expect(typeof stateObject.state).toBe('string');
      expect(stateObject.state).toBeTruthy();
      await wallet.close();

      const restoredWallet = await WalletBuilder.restore(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        serialized,
        'info',
      );
      restoredWallet.start();
      const newState = await waitForSync(restoredWallet);
      compareStates(newState, state);
      expect(newState.syncProgress?.total).toBeGreaterThanOrEqual(state.syncProgress?.total ?? 0n);
      await restoredWallet.close();
    },
    timeout,
  );

  test('Wallet state returns coinPublicKey hex string', async () => {
    allure.tms('PM-8920', 'PM-8920');
    allure.epic('Headless wallet');
    allure.feature('Wallet state');
    allure.story('Wallet state properties - fresh');
    const state = await firstValueFrom(wallet.state());
    expect(state.coinPublicKey).toMatch(/^[0-9a-f]{64}$/);
  });

  test('Wallet state returns encryptionPublicKey hex string', async () => {
    allure.tms('PM-8921', 'PM-8921');
    allure.epic('Headless wallet');
    allure.feature('Wallet state');
    allure.story('Wallet state properties - fresh');
    const state = await firstValueFrom(wallet.state());
    expect(state.encryptionPublicKey).toMatch(/^[0-9a-f]{116}$/);
  });

  test('Wallet state returns address as the concatenation of coinPublicKey and encryptionPublicKey', async () => {
    allure.tms('PM-8922', 'PM-8922');
    allure.epic('Headless wallet');
    allure.feature('Wallet state');
    allure.story('Wallet state properties - fresh');
    const state = await firstValueFrom(wallet.state());
    expect(state.address).toMatch(/^[0-9a-f]{64}\|[0-9a-f]{116}$/);
    expect(state.address).toBe(state.coinPublicKey + '|' + state.encryptionPublicKey);
  });

  test(
    'Midnight wallet returns empty object of balances',
    async () => {
      allure.tms('PM-8923', 'PM-8923');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - fresh');
      const state = await waitForSync(wallet);
      expect(state.balances).toMatchObject({});
    },
    timeout,
  );

  test(
    'Midnight wallet returns no coins',
    async () => {
      allure.tms('PM-8924', 'PM-8924');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - fresh');
      const state = await waitForSync(wallet);
      expect(state.coins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Midnight wallet returns no nullifiers',
    async () => {
      allure.tms('PM-12948', 'PM-12948');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - fresh');
      const state = await waitForSync(wallet);
      expect(state.nullifiers).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Midnight wallet returns no available coins',
    async () => {
      allure.tms('PM-8925', 'PM-8925');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - fresh');
      const state = await waitForSync(wallet);
      expect(state.availableCoins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Midnight wallet returns no pending coins',
    async () => {
      allure.tms('PM-8926', 'PM-8926');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - fresh');
      const state = await waitForSync(wallet);
      expect(state.pendingCoins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Midnight wallet returns no tx history',
    async () => {
      allure.tms('PM-8927', 'PM-8927');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - fresh');
      const state = await waitForSync(wallet);
      expect(state.transactionHistory).toHaveLength(0);
    },
    timeout,
  );
});
