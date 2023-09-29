/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { firstValueFrom } from 'rxjs';
import { WalletBuilder } from '../../node_modules/@midnight/wallet/main';
import * as KeyManagement from '../../../../node_modules/@cardano-sdk/key-management/dist/cjs';
import { useTestContainersFixture } from './test-fixture';

const encodeToHexString = (str: string): string => {
  const grouped = [];
  for (let i = 0; i < str.length; i += 2) {
    grouped.push(str.slice(i, i + 2));
  }
  return grouped.map((element) => element.charCodeAt(0).toString(16).padStart(2, '0')).join('');
};

describe('Fresh wallet with empty state', () => {
  const getFixture = useTestContainersFixture();
  const entropy = 'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82';
  const seed = encodeToHexString(entropy);

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

    const mnPattern = /^[0-9a-f]{64}$/;
    const entropy = KeyManagement.util.mnemonicWordsToEntropy(mnemonics);
    const seed = encodeToHexString(entropy);
    const fixture = getFixture();

    try {
      const wallet = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seed,
        'info',
      );

      const state = await firstValueFrom(wallet.state());
      expect(state.publicKey).toMatch(mnPattern);
      await wallet.close();
    } catch (error: any) {
      if (error instanceof Error) {
        console.error(error.message);
      }
      console.error(error);
    }
  });

  test('Midnight wallet returns empty array of balances', async () => {
    const fixture = getFixture();
    try {
      const wallet = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seed,
        'info',
      );

      wallet.start();
      const state = await firstValueFrom(wallet.state());
      expect(state.balances).toHaveLength(0);
      await wallet.close();
    } catch (error: any) {
      if (error instanceof Error) {
        console.error(error.message);
      }
      console.error(error);
    }
  });

  test('Midnight wallet returns no coins', async () => {
    const fixture = getFixture();
    try {
      const wallet = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seed,
        'info',
      );

      wallet.start();
      const state = await firstValueFrom(wallet.state());
      expect(state.coins).toHaveLength(0);
      await wallet.close();
    } catch (error: any) {
      if (error instanceof Error) {
        console.error(error.message);
      }
      console.error(error);
    }
  });

  test('Midnight wallet returns no available coins', async () => {
    const fixture = getFixture();
    try {
      const wallet = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seed,
        'info',
      );

      wallet.start();
      const state = await firstValueFrom(wallet.state());
      expect(state.availableCoins).toHaveLength(0);
      await wallet.close();
    } catch (error: any) {
      if (error instanceof Error) {
        console.error(error.message);
      }
      console.error(error);
    }
  });

  test('Midnight wallet returns no tx history', async () => {
    const fixture = getFixture();
    try {
      const wallet = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seed,
        'info',
      );

      wallet.start();
      const state = await firstValueFrom(wallet.state());
      expect(state.transactionHistory).toHaveLength(0);
      await wallet.close();
    } catch (error: any) {
      if (error instanceof Error) {
        console.error(error.message);
      }
      console.error(error);
    }
  });
});
