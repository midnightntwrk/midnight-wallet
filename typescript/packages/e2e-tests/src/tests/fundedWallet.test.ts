import { Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture';
import { NetworkId, nativeToken, setNetworkId } from '@midnight-ntwrk/zswap';
import { webcrypto } from 'crypto';
import { waitForSync } from './utils';
import { Wallet } from '@midnight-ntwrk/wallet-api';

// @ts-expect-error: It's needed to make Scala.js and WASM code able to use cryptography
globalThis.crypto = webcrypto;

/**
 * Tests using a funded wallet
 *
 * @group undeployed
 */

describe('Funded wallet', () => {
  const getFixture = useTestContainersFixture();
  const seedFunded = '0000000000000000000000000000000000000000000000000000000000000042';
  const timeout = 120_000;

  let wallet: Wallet & Resource;

  beforeEach(async () => {
    const fixture = getFixture();
    setNetworkId(TestContainersFixture.network === 'devnet' ? NetworkId.DevNet : NetworkId.Undeployed);

    wallet = await WalletBuilder.buildFromSeed(
      fixture.getIndexerUri(),
      fixture.getIndexerWsUri(),
      fixture.getProverUri(),
      fixture.getNodeUri(),
      seedFunded,
      'info',
    );
    wallet.start();
  });

  afterEach(async () => {
    await wallet.close();
  });

  test(
    'Wallet balance for native token is 25B tDUST and there are no other token types',
    async () => {
      const state = await waitForSync(wallet);
      expect(Object.keys(state.balances)).toHaveLength(1);
      const balance = state?.balances[nativeToken()] ?? 0n;
      expect(balance).toBe(25_000_000_000_000_000n);
    },
    timeout,
  );

  test(
    'Wallet has 5 coins',
    async () => {
      const state = await waitForSync(wallet);
      const coins = state?.coins;
      expect(coins).toHaveLength(5);
      coins.forEach((coin) => {
        expect(coin.type).toBe('0100000000000000000000000000000000000000000000000000000000000000000000');
        expect(coin.value).toBe(5000000000000000n);
      });
    },
    timeout,
  );

  test(
    'Wallet has 5 available coins',
    async () => {
      const state = await waitForSync(wallet);
      const coins = state?.availableCoins;
      expect(coins).toHaveLength(5);
      coins.forEach((coin) => {
        expect(coin.type).toBe('0100000000000000000000000000000000000000000000000000000000000000000000');
        expect(coin.value).toBe(5000000000000000n);
      });
    },
    timeout,
  );

  test(
    'Wallet has no pending coins',
    async () => {
      const state = await waitForSync(wallet);
      const coins = state?.pendingCoins;
      expect(coins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Wallet has one tx in tx history',
    async () => {
      const state = await waitForSync(wallet);
      const txHistory = state?.transactionHistory;
      expect(txHistory).toHaveLength(1);
      txHistory.forEach((tx) => {
        expect(tx.applyStage).toBe('SucceedEntirely');
        expect(tx.deltas).toStrictEqual({
          '0100000000000000000000000000000000000000000000000000000000000000000000': -50000000000000000n,
        });
        expect(tx.identifiers).not.toHaveLength(0);
      });
    },
    timeout,
  );
});
