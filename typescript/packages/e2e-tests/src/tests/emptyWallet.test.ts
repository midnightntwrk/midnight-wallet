/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { firstValueFrom } from 'rxjs';
import { Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import { webcrypto } from 'crypto';
import * as KeyManagement from '../../../../node_modules/@cardano-sdk/key-management/dist/cjs';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture';
import { MidnightNetwork, waitForSync } from './utils';
import { NetworkId, setNetworkId } from '@midnight-ntwrk/zswap';
import { Wallet } from '@midnight-ntwrk/wallet-api';

// @ts-expect-error: It's needed to make Scala.js and WASM code able to use cryptography
globalThis.crypto = webcrypto;

/**
 * Tests using an empty wallet
 *
 * @group undeployed
 * @group devnet
 */

describe('Midnight wallet', () => {
  const getFixture = useTestContainersFixture();

  test('Valid Midnight wallet can be built from a BIP32 compatible mnemonic seed phrase', async () => {
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
    await expect(
      WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        entropy,
        'info',
      ),
    ).resolves.not.toThrow();
  });
});

describe('Fresh wallet with empty state', () => {
  const getFixture = useTestContainersFixture();
  const seed = 'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82';
  const timeout = (process.env.NETWORK as MidnightNetwork) === 'devnet' ? 240_000 : 60_000;

  let wallet: Wallet & Resource;

  beforeEach(async () => {
    const fixture = getFixture();
    setNetworkId(TestContainersFixture.network === 'devnet' ? NetworkId.DevNet : NetworkId.Undeployed);

    wallet = await WalletBuilder.buildFromSeed(
      fixture.getIndexerUri(),
      fixture.getIndexerWsUri(),
      fixture.getProverUri(),
      fixture.getNodeUri(),
      seed,
      'info',
    );
    wallet.start();
  });

  afterEach(async () => {
    await wallet.close();
  });

  test('Wallet state returns coinPublicKey hex string', async () => {
    const state = await firstValueFrom(wallet.state());
    expect(state.coinPublicKey).toMatch(/^[0-9a-f]{64}$/);
  });

  test('Wallet state returns encryptionPublicKey hex string', async () => {
    const state = await firstValueFrom(wallet.state());
    expect(state.encryptionPublicKey).toMatch(/^[0-9a-f]{70}$/);
  });

  test('Wallet state returns address as the concatenation of coinPublicKey and encryptionPublicKey', async () => {
    const state = await firstValueFrom(wallet.state());
    expect(state.address).toMatch(/^[0-9a-f]{64}\|[0-9a-f]{70}$/);
    expect(state.address).toBe(state.coinPublicKey + '|' + state.encryptionPublicKey);
  });

  test(
    'Midnight wallet returns empty object of balances',
    async () => {
      const state = await waitForSync(wallet);
      expect(state.balances).toMatchObject({});
    },
    timeout,
  );

  test(
    'Midnight wallet returns no coins',
    async () => {
      const state = await waitForSync(wallet);
      expect(state.coins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Midnight wallet returns no available coins',
    async () => {
      const state = await waitForSync(wallet);
      expect(state.availableCoins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Midnight wallet returns no pending coins',
    async () => {
      const state = await waitForSync(wallet);
      expect(state.pendingCoins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Midnight wallet returns no tx history',
    async () => {
      const state = await waitForSync(wallet);
      expect(state.transactionHistory).toHaveLength(0);
    },
    timeout,
  );
});
