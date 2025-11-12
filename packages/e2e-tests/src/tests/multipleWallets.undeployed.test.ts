import { DustParameters, LedgerParameters, nativeToken } from '@midnight-ntwrk/ledger-v6';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { firstValueFrom } from 'rxjs';
import { logger } from './logger.js';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import { getShieldedSeed, waitForSyncFacade } from './utils.js';
import * as allure from 'allure-js-commons';
import { ShieldedWallet, ShieldedWalletClass } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  PublicKey,
  UnshieldedKeystore,
  UnshieldedWallet,
  WalletBuilder,
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
  const timeout = 240_000;
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
  const rawNativeTokenType = (nativeToken() as { tag: string; raw: string }).raw;

  beforeEach(async () => {
    await allure.step('Start multiple wallets', async function () {
      fixture = getFixture();
      const walletConfig = fixture.getWalletConfig(NetworkId.NetworkId.Undeployed);
      Wallet = ShieldedWallet(walletConfig);
      const Dust = DustWallet({
        ...walletConfig,
        costParameters: {
          ledgerParams: LedgerParameters.initialParameters(),
          additionalFeeOverhead: 300_000_000_000_000n,
        },
      });
      const dustParameters = new DustParameters(5_000_000_000n, 8_267n, 3n * 60n * 60n);

      async function buildWallets(seeds: Uint8Array<ArrayBufferLike>[]) {
        for (let i = 0; i < seeds.length; i++) {
          unshieldedKeystores[i] = createKeystore(seeds[i], fixture.getNetworkId());
          shieldedWallets[i] = Wallet.startWithShieldedSeed(seeds[i]);
          dustWallets[i] = Dust.startWithSeed(seeds[i], dustParameters, NetworkId.NetworkId.Undeployed);
        }

        for (let i = 0; i < seeds.length; i++) {
          unshieldedWallets[i] = await WalletBuilder.build({
            publicKey: PublicKey.fromKeyStore(unshieldedKeystores[i]),
            networkId: NetworkId.NetworkId.Undeployed,
            indexerUrl: fixture.getIndexerWsUri(),
          });
        }

        for (let i = 0; i < seeds.length; i++) {
          facades[i] = new WalletFacade(shieldedWallets[i], unshieldedWallets[i], dustWallets[i]);
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
        expect(syncedState.unshielded.syncProgress).toBeTruthy();
      }
    },
    timeout,
  );
});
