/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { firstValueFrom } from 'rxjs';
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import * as KeyManagement from '../../../../node_modules/@cardano-sdk/key-management/dist/cjs';
import { useTestContainersFixture } from './test-fixture';

describe('Fresh wallet with empty state', () => {
  const getFixture = useTestContainersFixture();
  const seed = 'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82';

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

  test('Wallet state returns coinPublicKey hex string', async () => {
    const fixture = getFixture();

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
    expect(state.coinPublicKey).toMatch(/^[0-9a-f]{64}$/);
    await wallet.close();
  });

  test('Wallet state returns encryptionPublicKey hex string', async () => {
    const fixture = getFixture();

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
    expect(state.encryptionPublicKey).toMatch(/^[0-9a-f]{70}$/);
    await wallet.close();
  });

  test('Wallet state returns address as the concatenation of coinPublicKey and encryptionPublicKey', async () => {
    const fixture = getFixture();

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
    expect(state.address).toMatch(/^[0-9a-f]{64}\|[0-9a-f]{70}$/);
    expect(state.address).toBe(state.coinPublicKey + '|' + state.encryptionPublicKey);
    await wallet.close();
  });

  test('Midnight wallet returns empty object of balances', async () => {
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
      expect(state.balances).toMatchObject({});
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
