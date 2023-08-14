import { WalletBuilder } from '@midnight/wallet';
import { combineLatest, firstValueFrom } from 'rxjs';
import { loadConfig } from './config';
import { getInitialWalletState } from './config/genesis';
import { WalletCodec } from '@midnight/genesis-gen';

export async function checkConnection() {
  try {
    const config = loadConfig();

    const walletInitialState = getInitialWalletState(config.genesisFilePath, config.wallet);

    if (walletInitialState == null) {
      throw new Error('Initial wallet state could not be found. Please check your config.');
    }

    const wallet = await WalletBuilder.connect(
      `ws://${config.nodeHost}:${config.nodePort}`,
      WalletCodec.encode(walletInitialState),
      'error',
    );

    wallet.start();

    await firstValueFrom(combineLatest([wallet.connect(), wallet.balance(), wallet.installTxFilter(() => true)]));
    console.log('Wallet successfully connected to the node.');
    process.exit(0);
  } catch (e) {
    console.error('There were issues with configuration or node connection');
    console.error(e);
    process.exit(1);
  }
}
