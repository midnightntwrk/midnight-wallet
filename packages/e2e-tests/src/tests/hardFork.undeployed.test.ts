/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

// allows submitting transactions using ledger v3 = v1 (only post-rollback, not post-HF1)
import { Resource, WalletBuilder as WalletBuilderPostHF } from '@midnight-ntwrk/wallet_post_hf';
import { WalletBuilder as WalletBuilderPreHF } from '@midnight-ntwrk/wallet_pre_hf';
import { useHardForkFixture } from './test-fixture';
import { NetworkId, TokenType, nativeToken } from '@midnight-ntwrk/zswap_v2';
import { NetworkId as NetworkIdPreHf, nativeToken as nativeTokenPreHf } from '@midnight-ntwrk/zswap_v1';
import {
  closeWallet,
  normalizeWalletState,
  verifyThatLogIsPresent,
  waitForIndex,
  waitForSync,
  waitForTxInHistory,
  walletStateTrimmed,
} from './utilsHf';
import { Wallet } from '@midnight-ntwrk/wallet-api_hf';
import { logger } from './logger';
import { readFileSync, writeFileSync } from 'node:fs';
import { GenericContainer } from 'testcontainers/build/generic-container/generic-container';
import * as allure from 'allure-js-commons';

/**
 * Hard fork tests
 *
 * @group undeployed
 */

describe('Hard fork', () => {
  // Spin up HF environment.
  const _ = useHardForkFixture();

  let seed: string = '0000000000000000000000000000000000000000000000000000000000000042';
  const seedSender: string = '0000000000000000000000000000000000000000000000000000000000000043';
  const timeout = 240_000;

  let wallet: Wallet & Resource;
  let walletSender: Wallet & Resource;
  let serialized: string;
  let expectedBalance: Record<TokenType, bigint>;
  let expectedTxHistory: object[];
  let expectedBalanceSender: Record<TokenType, bigint>;
  let expectedTxHistorySender: object[];

  const outputValue = 10n;
  const nativeTokenHash = '02000000000000000000000000000000000000000000000000000000000000000001';

  beforeAll(async () => {
    wallet = await WalletBuilderPreHF.buildFromSeed(
      'http://localhost:8088',
      'ws://localhost:8088',
      'http://localhost:6300',
      'http://localhost:9944',
      seed,
      NetworkIdPreHf.Undeployed,
      'info',
    );
    wallet.start();
    await waitForSync(wallet);
    const serializedPre = await wallet.serializeState();
    writeFileSync('res/undeployedPreHf.state', serializedPre, {
      flag: 'w',
    });
    serialized = readFileSync('./res/undeployedPreHf.state', 'utf-8');
    await closeWallet(wallet);
    walletSender = await WalletBuilderPreHF.buildFromSeed(
      'http://localhost:8088',
      'ws://localhost:8088',
      'http://localhost:6300',
      'http://localhost:9944',
      seedSender,
      NetworkIdPreHf.Undeployed,
      'info',
    );
    walletSender.start();
    await waitForSync(walletSender);
    const serializedSenderPre = await walletSender.serializeState();
    writeFileSync('res/undeployedSenderPreHf.state', serializedSenderPre, {
      flag: 'w',
    });
    await closeWallet(walletSender);
  }, 120_000);

  beforeEach(async () => {
    await allure.step('Start a wallet', function () {
      seed = '0000000000000000000000000000000000000000000000000000000000000042';
      serialized = readFileSync('./res/undeployedPreHf.state', 'utf-8');
      expectedBalance = {
        '02000000000000000000000000000000000000000000000000000000000000000000': 25000000000000000n,
        '02000000000000000000000000000000000000000000000000000000000000000001': 5000000000000000n,
        '02000000000000000000000000000000000000000000000000000000000000000002': 5000000000000000n,
      };
      expectedTxHistory = [
        {
          applyStage: 'SucceedEntirely',
          deltas: {
            '02000000000000000000000000000000000000000000000000000000000000000000': -100000000000000000n,
            '02000000000000000000000000000000000000000000000000000000000000000001': -20000000000000000n,
            '02000000000000000000000000000000000000000000000000000000000000000002': -20000000000000000n,
          },
          identifiers: [
            '00000000459288608c7faa8a76bf172e5b6da2dc9cb86891dca4832d90d1bdd9751c46230fbdbf78a58cd3b12bce913982f97dc835715b025afe6a9d',
            '0000000001bd938cf8c7dcd68256ef31475a707c13cfbf93405112370740fbff2eab9d219515b4b35f58abb73048976f695a36914d4cb3a30387139b',
            '00000000ee282797040ec7e827e493fc50785dd4e48e11b0ac0430e515c70ff99c84c3687d30e956210887699207a616260cb52e24fb00fca2d8fe08',
            '000000009702fb6e656b63e9a99489f982870d5921d695a94a16da60b78da8879404d1e3251f83ac3e6ae3426727f70efaf76efcdcf2eed46e7aa523',
            '00000000491a0d58d0166fb5951303bf2f26cdbb3a1ff9be931ae574bb5847f2d9abc782e1de98de72727f89ec4c496779fd760e4dda5eaaae13b084',
            '000000002589544336ee46f960f54ada92af7434247fcd22e429204d808829599aab4029efdcd7a5530c41818c3701a532a578cf7cd83d83b1871683',
            '00000000dcfb1b72ed6e4381659828d60f0168cdabfcb6c7bafdd334419f433c6a3ea5a0001fa1514997ef1c7855ddc93db588dd35f4c76b5ae9a413',
            '00000000e10e7949b57baaeb7cf79800e7f576f902efb5ff28b3b164e4be4f477e6d23d136e73c905eb0c263d394bcd7238999b522bcc8fb63017602',
            '0000000075f2b53c29d7df7d4246ec07983cbccececf0e46a632820de7d9e96c399a40930c353eb34286feecfe0794e88cb334de1677833c58e42492',
            '0000000019bb93d6528f0f921eb1e5159518f043cdea422d421aa1722b9daa2bd43d9e5a837ddaeb751446e2c7e6644dd4f888750245691971405592',
            '000000008a4a435ec551e0f62cd99b815272abb45ff961c09271c8ac0e5c3120958d147c40723d47dda0cb840e434d0452a5527f2c943a4370ba0617',
            '0000000064aba66535d930149bfd96e6cacb95ab21f2b91ec1cac082c9da7971e762302802732cbb0a785e24be534d9ab29e258881d63905b690e809',
            '000000003bd8e24812b2e86e86f5a2a8f97b06dd5a9077f6122b24d6948c7f0739ca7538daacdec750ac33be351206cef1c8932d45f39a98afb0d098',
            '00000000190e8760657c02cd8534db18c5d5949d8253c3faefd38a12c74d9dcabdd78f52944277dd9892951a13bd06e7169499b50d2a6014cd13379f',
            '000000008fe0cfae6206d1309b520af297091778dd83302abc7c6a9a171aaad9a86f918637ffb6499d7b35b6e04c6cfe318f98ee1d644c2c4b2f119f',
            '00000000ce199b87dcf0713f82b25b3568d9332e6196dcc2892813e8fcc78e3e01922de109183f52dc537865beead816a95013fdacdd52a0f435070a',
            '00000000530380780c88e691d963437b4957960c6ce16538ef81b200d703b610756c2715243875ef8dea80a79eed2043226136f722e52aa28db9a99f',
            '00000000a023506e95d3c8343a5fa3a19de877ab1702825310e52e7c018a3dcf9db8130ced62cfc92b84fde4171a6eb07d4b12131d92097af1c9000d',
            '0000000078382c1b171166a153a6ffa5d24ad5c5f76d3a1d9735970a3d2f95e13776368e32c231e483624ddd520d6f359d32a8ecea3d0948ccecdd92',
            '00000000de65944c9ca035c6d2e1811d456dddc9735585548581388b014367929c7a4fba5616af03162f2a15fd4610876a1c680bc96333698f861a97',
            '00000000d9bbd6aca892f612742439fe7ce15781df0be2e9af7a50e6d488ab7af65ebd71b21849892121345fac00de96ba09068711677de4c31b821b',
            '00000000293e5a5ccbc6a0e11bbbd79e30397000725602ad8290d753ed35c9c9fc683951ac7f44271b31a5150a678de7ded113e8e06652a66c498012',
            '00000000068ef43d86268368f0cf2a05277fbf64e68327db22b03418fe643c7df1f87db035fe4584b9442ffaedc8fb17d7e7f18f513c5df018bd9f80',
            '000000009b030a0d297ea3bbea4aabb5eed3e6c7fadb085c75e875bf36664723d8d16daea00b7af27e5477a52bb125980233befef117322d88068388',
            '000000007fdd7a6f3fc66a4fec78bab8fbf6fde8243995d0db0e565ab83f3491f9138446552706c49286803ae4953587d3fe19f76cfc06b6c7c85f12',
            '000000009b8c67eb8a336a890b1c8650f3984d38d2997e5b6e1d066aac9bc36db4809da24a5e5082872f705eea31fd9786875727ec8d352188ba2405',
            '00000000170d31b266fdcc8d5d824930c33816b345e71a798e3b99a9b9ac877cbb91908ae2008499f301ae78b7c17896e9d4481e220f0fc6ff2fb781',
            '0000000000db0e5fb534f8eba0888fee9422737251ee5a9c9cce04ef5e5f66f3aa181835d23d849802659427db7fed518ff115fb587f2d23ac07228e',
          ],
          transactionHash: 'afa7de747860563ff6d46a2b249b103050e56c5de3100123172cbbaee75b2ef7',
        },
      ];
      expectedBalanceSender = {
        '02000000000000000000000000000000000000000000000000000000000000000000': 24999999999863226n,
        '02000000000000000000000000000000000000000000000000000000000000000001': 5000000000000000n,
        '02000000000000000000000000000000000000000000000000000000000000000002': 5000000000000000n,
      };
      expectedTxHistorySender = [
        {
          applyStage: 'SucceedEntirely',
          deltas: {
            '02000000000000000000000000000000000000000000000000000000000000000000': -100000000000000000n,
            '02000000000000000000000000000000000000000000000000000000000000000001': -20000000000000000n,
            '02000000000000000000000000000000000000000000000000000000000000000002': -20000000000000000n,
          },
          identifiers: [
            '00000000459288608c7faa8a76bf172e5b6da2dc9cb86891dca4832d90d1bdd9751c46230fbdbf78a58cd3b12bce913982f97dc835715b025afe6a9d',
            '0000000001bd938cf8c7dcd68256ef31475a707c13cfbf93405112370740fbff2eab9d219515b4b35f58abb73048976f695a36914d4cb3a30387139b',
            '00000000ee282797040ec7e827e493fc50785dd4e48e11b0ac0430e515c70ff99c84c3687d30e956210887699207a616260cb52e24fb00fca2d8fe08',
            '000000009702fb6e656b63e9a99489f982870d5921d695a94a16da60b78da8879404d1e3251f83ac3e6ae3426727f70efaf76efcdcf2eed46e7aa523',
            '00000000491a0d58d0166fb5951303bf2f26cdbb3a1ff9be931ae574bb5847f2d9abc782e1de98de72727f89ec4c496779fd760e4dda5eaaae13b084',
            '000000002589544336ee46f960f54ada92af7434247fcd22e429204d808829599aab4029efdcd7a5530c41818c3701a532a578cf7cd83d83b1871683',
            '00000000dcfb1b72ed6e4381659828d60f0168cdabfcb6c7bafdd334419f433c6a3ea5a0001fa1514997ef1c7855ddc93db588dd35f4c76b5ae9a413',
            '00000000e10e7949b57baaeb7cf79800e7f576f902efb5ff28b3b164e4be4f477e6d23d136e73c905eb0c263d394bcd7238999b522bcc8fb63017602',
            '0000000075f2b53c29d7df7d4246ec07983cbccececf0e46a632820de7d9e96c399a40930c353eb34286feecfe0794e88cb334de1677833c58e42492',
            '0000000019bb93d6528f0f921eb1e5159518f043cdea422d421aa1722b9daa2bd43d9e5a837ddaeb751446e2c7e6644dd4f888750245691971405592',
            '000000008a4a435ec551e0f62cd99b815272abb45ff961c09271c8ac0e5c3120958d147c40723d47dda0cb840e434d0452a5527f2c943a4370ba0617',
            '0000000064aba66535d930149bfd96e6cacb95ab21f2b91ec1cac082c9da7971e762302802732cbb0a785e24be534d9ab29e258881d63905b690e809',
            '000000003bd8e24812b2e86e86f5a2a8f97b06dd5a9077f6122b24d6948c7f0739ca7538daacdec750ac33be351206cef1c8932d45f39a98afb0d098',
            '00000000190e8760657c02cd8534db18c5d5949d8253c3faefd38a12c74d9dcabdd78f52944277dd9892951a13bd06e7169499b50d2a6014cd13379f',
            '000000008fe0cfae6206d1309b520af297091778dd83302abc7c6a9a171aaad9a86f918637ffb6499d7b35b6e04c6cfe318f98ee1d644c2c4b2f119f',
            '00000000ce199b87dcf0713f82b25b3568d9332e6196dcc2892813e8fcc78e3e01922de109183f52dc537865beead816a95013fdacdd52a0f435070a',
            '00000000530380780c88e691d963437b4957960c6ce16538ef81b200d703b610756c2715243875ef8dea80a79eed2043226136f722e52aa28db9a99f',
            '00000000a023506e95d3c8343a5fa3a19de877ab1702825310e52e7c018a3dcf9db8130ced62cfc92b84fde4171a6eb07d4b12131d92097af1c9000d',
            '0000000078382c1b171166a153a6ffa5d24ad5c5f76d3a1d9735970a3d2f95e13776368e32c231e483624ddd520d6f359d32a8ecea3d0948ccecdd92',
            '00000000de65944c9ca035c6d2e1811d456dddc9735585548581388b014367929c7a4fba5616af03162f2a15fd4610876a1c680bc96333698f861a97',
            '00000000d9bbd6aca892f612742439fe7ce15781df0be2e9af7a50e6d488ab7af65ebd71b21849892121345fac00de96ba09068711677de4c31b821b',
            '00000000293e5a5ccbc6a0e11bbbd79e30397000725602ad8290d753ed35c9c9fc683951ac7f44271b31a5150a678de7ded113e8e06652a66c498012',
            '00000000068ef43d86268368f0cf2a05277fbf64e68327db22b03418fe643c7df1f87db035fe4584b9442ffaedc8fb17d7e7f18f513c5df018bd9f80',
            '000000009b030a0d297ea3bbea4aabb5eed3e6c7fadb085c75e875bf36664723d8d16daea00b7af27e5477a52bb125980233befef117322d88068388',
            '000000007fdd7a6f3fc66a4fec78bab8fbf6fde8243995d0db0e565ab83f3491f9138446552706c49286803ae4953587d3fe19f76cfc06b6c7c85f12',
            '000000009b8c67eb8a336a890b1c8650f3984d38d2997e5b6e1d066aac9bc36db4809da24a5e5082872f705eea31fd9786875727ec8d352188ba2405',
            '00000000170d31b266fdcc8d5d824930c33816b345e71a798e3b99a9b9ac877cbb91908ae2008499f301ae78b7c17896e9d4481e220f0fc6ff2fb781',
            '0000000000db0e5fb534f8eba0888fee9422737251ee5a9c9cce04ef5e5f66f3aa181835d23d849802659427db7fed518ff115fb587f2d23ac07228e',
          ],
          transactionHash: 'afa7de747860563ff6d46a2b249b103050e56c5de3100123172cbbaee75b2ef7',
        },

        {
          applyStage: 'SucceedEntirely',
          deltas: { '02000000000000000000000000000000000000000000000000000000000000000000': 136774n },
          identifiers: [
            '0000000046de6ce5d2d4c6b97ccb41867eefdd27becc4dfda322523f71c89de8541aca6999e6e4a0647150bb40d2ae8a4f827db598cc6efc68f64ea0',
            '00000000d9b31ab7a10b928a8a25282df84b16bf6e27a0c3e1d51c3fa1e70ad072fa7edaec0cc84f472660430828fe3f8f216de2789016182beade23',
            '000000002728199866845048749d52b07b526e9ff40de997f52da215727a25f74289f8ec9f52232f469de9889ad15829705d62cff5703cd1582bd71f',
            '0000000075516f4fa0ee94e72515251a7194cf0799562e47d66b9972e6824e60c80582135bc7174614f3902bd4091fcd737755ef7f9a98c7fd7d078b',
            '00000000126ddf3cc77fec52884e3912a64d825db0d51fb892cd1efdb1c2220ffd8103ca9b5cbba350f7d54ee8f04284a0b1844e6fc8e07073b81316',
          ],
          transactionHash: '88dc93f4ad3e94c9538c14646f3a9740c98dcaa5525a28cf4b197ca1760d866b',
        },
      ];
    });
  });

  afterEach(async () => {
    await closeWallet(wallet);
    await closeWallet(walletSender);
  });

  describe('Pre-HF tests', () => {
    test(
      'Wallet can sync from scratch and balance and txHistory match @healthcheck @pre',
      async () => {
        allure.tag('healthcheck');
        allure.tms('PM-11394', 'PM-11394');
        allure.epic('Headless wallet');
        allure.feature('Hard Forks');
        allure.story('Sync from scratch pre-HF');

        wallet = await WalletBuilderPreHF.buildFromSeed(
          'http://localhost:8088',
          'ws://localhost:8088',
          'http://localhost:6300',
          'http://localhost:9944',
          seed,
          NetworkIdPreHf.Undeployed,
          'info',
        );
        wallet.start();

        const state = await waitForSync(wallet);
        state.transactionHistory.forEach((e) => logger.info(e));
        expect(state.syncProgress?.synced).toBeGreaterThan(0);
        expect(state.balances).toEqual(expectedBalance);
        expect(normalizeWalletState(state).normalized).toEqual(expectedTxHistory);
      },
      timeout,
    );

    test(
      'Wallet can sync from a serialized state and balance and txHistory match @healthcheck @pre',
      async () => {
        allure.tag('smoke');
        allure.tms('PM-11394', 'PM-11394');
        allure.epic('Headless wallet');
        allure.feature('Hard Forks');
        allure.story('Restore from serialized state pre-HF');

        const restoredWallet = await WalletBuilderPreHF.restore(
          'http://localhost:8088',
          'ws://localhost:8088',
          'http://localhost:6300',
          'http://localhost:9944',
          serialized,
          'info',
        );
        restoredWallet.start();
        const newState = await waitForSync(restoredWallet);
        const serializedNew = await wallet.serializeState();
        const stateObject = JSON.parse(serializedNew);
        expect(stateObject.txHistory).toHaveLength(1);
        expect(stateObject.offset).toBeGreaterThan(0);
        expect(typeof stateObject.state).toBe('string');
        expect(stateObject.state).toBeTruthy();
        expect(newState.syncProgress?.total).toBeGreaterThanOrEqual(stateObject.state.syncProgress?.total ?? 0n);
        expect(newState.balances).toEqual(expectedBalance);
        expect(normalizeWalletState(newState).normalized).toEqual(expectedTxHistory);
        await closeWallet(restoredWallet);
      },
      timeout,
    );

    test(
      'Wallet can transact before HF @healthcheck @pre',
      async () => {
        allure.tag('healthcheck');
        allure.tms('PM-11392', 'PM-11392');
        allure.epic('Headless wallet');
        allure.feature('Hard Forks');
        allure.story('Submitting a valid transaction pre-HF');

        wallet = await WalletBuilderPreHF.buildFromSeed(
          'http://localhost:8088',
          'ws://localhost:8088',
          'http://localhost:6300',
          'http://localhost:9944',
          '0000000000000000000000000000000000000000000000000000000000000043',
          NetworkIdPreHf.Undeployed,
          'info',
        );
        wallet.start();

        const state = await waitForSync(wallet);
        expect(state.syncProgress?.synced).toBeGreaterThan(0);
        expect(state.balances).toEqual(expectedBalance);
        expect(normalizeWalletState(state).normalized).toEqual(expectedTxHistory);

        const outputsToCreate = [
          {
            type: nativeTokenHash,
            amount: outputValue,
            receiverAddress: state.address,
          },
        ];
        const txToProve = await wallet.transferTransaction(outputsToCreate);
        const provenTx = await wallet.proveTransaction(txToProve);
        const txId = await wallet.submitTransaction(provenTx);
        logger.info('Transaction id: ' + txId);

        await waitForTxInHistory(txId, wallet);
        const finalState = await waitForSync(wallet);
        logger.info(finalState.transactionHistory);
        logger.info(walletStateTrimmed(finalState));
        logger.info(`Wallet 1 available coins: ${finalState.availableCoins.length}`);
        const serializedTx = await wallet.serializeState();
        writeFileSync('res/undeployedSentPreHf.state', serializedTx, {
          flag: 'w',
        });
        expect(finalState.transactionHistory.length).toBe(2);
        expect(finalState.availableCoins.length).toBeGreaterThan(state.availableCoins.length);
        expect(finalState.balances[nativeTokenPreHf()]).toBeLessThan(state.balances[nativeTokenPreHf()]);
        expect(finalState.balances[nativeTokenHash]).toBe(state.balances[nativeTokenHash]);
        logger.info(finalState);
        const stateObject = JSON.parse(serializedTx);
        expect(stateObject.txHistory).toHaveLength(2);
        expect(stateObject.protocolVersion).toEqual(1);
        // expectedTxHistorySender = normalizeWalletState(stateObject).normalized;
      },
      timeout,
    );
  });

  describe('Perform a hard fork', () => {
    test('Perform a hard fork', async () => {
      allure.tms('PM-11392', 'PM-11392');
      allure.epic('Headless wallet');
      allure.feature('Hard Forks');
      allure.story('Perform a HF');

      const upgrader = await new GenericContainer('ghcr.io/midnight-ntwrk/midnight-hardfork-test-upgrader:69581601')
        .withEnvironment({ RPC_URL: `ws://localhost:9944` })
        .withNetworkMode('host')
        .withCommand(['-t', '0', '--migrate'])
        .start();

      const stream = await upgrader.logs();
      await verifyThatLogIsPresent(stream, /Code update success: CodeUpdated/, 30000);
      await verifyThatLogIsPresent(stream, /Submission done ExtrinsicEvents/, 30000);
      await waitForProtocolAtIndexer(2);
    }, 120_000);
  });

  describe('Post-HF tests', () => {
    test(
      'Wallet can sync from scratch and balance and txHistory match @healthcheck @post',
      async () => {
        allure.tag('healthcheck');
        allure.tms('PM-11394', 'PM-11394');
        allure.epic('Headless wallet');
        allure.feature('Hard Forks');
        allure.story('Sync from scratch pre-HF');

        wallet = await WalletBuilderPostHF.buildFromSeed(
          'http://localhost:8088',
          'ws://localhost:8088',
          'http://localhost:6301',
          'http://localhost:9944',
          seed,
          NetworkId.Undeployed,
          'info',
        );
        wallet.start();

        const state = await waitForSync(wallet);
        state.transactionHistory.forEach((e) => logger.info(e));
        expect(state.syncProgress?.synced).toBeGreaterThan(0);
        expect(state.balances).toEqual(expectedBalance);
        expect(normalizeWalletState(state).normalized).toEqual(expectedTxHistory);

        await closeWallet(wallet);
      },
      timeout,
    );

    test(
      'Wallet can sync from a serialized state and balance and txHistory match @healthcheck @post',
      async () => {
        allure.tag('smoke');
        allure.tms('PM-11394', 'PM-11394');
        allure.epic('Headless wallet');
        allure.feature('Hard Forks');
        allure.story('Restore from serialized state pre-HF');

        const restoredWallet = await WalletBuilderPreHF.restore(
          'http://localhost:8088',
          'ws://localhost:8088',
          'http://localhost:6301',
          'http://localhost:9944',
          serialized,
          'info',
        );
        restoredWallet.start();
        const newState = await waitForSync(restoredWallet);
        const serializedNew = await wallet.serializeState();
        const stateObject = JSON.parse(serializedNew);
        expect(stateObject.txHistory).toHaveLength(1);
        expect(stateObject.offset).toBeGreaterThan(0);
        expect(typeof stateObject.state).toBe('string');
        expect(stateObject.state).toBeTruthy();
        expect(newState.syncProgress?.total).toBeGreaterThanOrEqual(stateObject.state.syncProgress?.total ?? 0n);
        expect(newState.balances).toEqual(expectedBalance);
        expect(normalizeWalletState(newState).normalized).toEqual(expectedTxHistory);
        await closeWallet(restoredWallet);
      },
      timeout,
    );

    test(
      'Sender wallet can sync from a serialized state and balance and txHistory match @healthcheck @post',
      async () => {
        allure.tag('smoke');
        allure.tms('PM-11394', 'PM-11394');
        allure.epic('Headless wallet');
        allure.feature('Hard Forks');
        allure.story('Restore from serialized state sent pre-HF');

        const restoredWallet = await WalletBuilderPreHF.restore(
          'http://localhost:8088',
          'ws://localhost:8088',
          'http://localhost:6301',
          'http://localhost:9944',
          readFileSync('./res/undeployedSentPreHf.state', 'utf-8'),
          'info',
        );
        restoredWallet.start();
        const newState = await waitForSync(restoredWallet);
        const serializedNew = await wallet.serializeState();
        const stateObject = JSON.parse(serializedNew);
        console.log(stateObject.txHistory);
        // expect(stateObject.txHistory).toHaveLength(0); // txHistory only shows new txs from the point of restoration
        expect(stateObject.offset).toBeGreaterThan(0);
        expect(typeof stateObject.state).toBe('string');
        expect(stateObject.state).toBeTruthy();
        expect(newState.syncProgress?.total).toBeGreaterThanOrEqual(stateObject.state.syncProgress?.total ?? 0n);
        expect(newState.balances).toEqual(expectedBalanceSender);
        // expect(normalizeWalletState(newState).normalized).toEqual(expectedTxHistorySender);
        await closeWallet(restoredWallet);
      },
      timeout,
    );

    test.skip(
      'Wallet can transact after HF @healthcheck @post',
      async () => {
        allure.tag('healthcheck');
        allure.tms('PM-11392', 'PM-11392');
        allure.epic('Headless wallet');
        allure.feature('Hard Forks');
        allure.story('Submitting a valid transaction post-HF');

        const preHFWallet = await WalletBuilderPreHF.buildFromSeed(
          'http://localhost:8088',
          'ws://localhost:8088',
          'http://localhost:6300',
          'http://localhost:9944',
          seedSender,
          NetworkIdPreHf.Undeployed,
          'info',
          true, // because we're completely skipping version combinator, we need to ignore transaction history
        );

        const preHFSerializedState = await preHFWallet.serializeState();
        console.log('pre hf serialized state', preHFSerializedState.slice(0, 100));

        await preHFWallet.close();

        wallet = await WalletBuilderPostHF.restore(
          'http://localhost:8088',
          'ws://localhost:8088',
          'http://localhost:6301',
          'http://localhost:9944',
          preHFSerializedState,
          'info',
          false,
        );
        wallet.start();

        console.log('GOT AFTER HF WALLET!');

        const state = await waitForSync(wallet);

        console.log('State after HF', state.syncProgress);

        expect(state.syncProgress?.synced).toBeGreaterThan(0);
        expect(state.balances).toEqual(expectedBalanceSender);
        expect(normalizeWalletState(state).normalized).toEqual(expectedTxHistorySender);

        const outputsToCreate = [
          {
            type: nativeTokenHash,
            amount: outputValue,
            receiverAddress: state.address,
          },
        ];
        const txToProve = await wallet.transferTransaction(outputsToCreate);
        const provenTx = await wallet.proveTransaction(txToProve);
        const txId = await wallet.submitTransaction(provenTx);
        logger.info('Transaction id: ' + txId);

        await waitForTxInHistory(txId, wallet);
        await waitForIndex(wallet, 30);
        const serializedPostNew = await wallet.serializeState();
        logger.info(serializedPostNew);
        writeFileSync('res/undeployedSentPostHf.state', serializedPostNew, {
          flag: 'w',
        });
        const walletPost = await WalletBuilderPostHF.restore(
          'http://localhost:8088',
          'ws://localhost:8088',
          'http://localhost:6301',
          'http://localhost:9944',
          serializedPostNew,
          'info',
          true,
        );
        walletPost.start();
        const finalState = await waitForSync(wallet);
        logger.info(finalState.transactionHistory);
        logger.info(walletStateTrimmed(finalState));
        logger.info(`Wallet 1 available coins: ${finalState.availableCoins.length}`);
        logger.info(`Wallet 1 tDUST: ${finalState.balances[nativeToken()]}`);
        logger.info(`Wallet 1 native token 1: ${finalState.balances[nativeTokenHash]}`);
        expect(finalState.transactionHistory.length).toBe(1);
        expect(finalState.availableCoins.length).toBeGreaterThan(state.availableCoins.length);
        const serializedPost = await wallet.serializeState();
        logger.info(serializedPost);
        const stateObject = JSON.parse(serializedPost);
        expect(stateObject.txHistory).toHaveLength(1);
        expect(stateObject.protocolVersion).toEqual(2);

        await closeWallet(wallet);
        await closeWallet(walletPost);
      },
      timeout,
    );
  });

  describe('Perform a rollback', () => {
    test('Perform a rollback', async () => {
      allure.tms('PM-11392', 'PM-11392');
      allure.epic('Headless wallet');
      allure.feature('Hard Forks');
      allure.story('Perform a rollback');

      const upgrader = await new GenericContainer('ghcr.io/midnight-ntwrk/midnight-hardfork-test-upgrader:69581601')
        .withEnvironment({
          RPC_URL: `ws://localhost:9944`,
          RUNTIME_PATH: '/midnight_node_runtime_rollback.compact.compressed.wasm',
        })
        .withNetworkMode('host')
        .withCommand(['-t', '0', '--rollback'])
        .start();

      const stream = await upgrader.logs();
      await verifyThatLogIsPresent(stream, /Code update success: CodeUpdated/, 30000);
      await verifyThatLogIsPresent(stream, /Submission done ExtrinsicEvents/, 30000);
      await waitForProtocolAtIndexer(3, 60_000);
    }, 120_000);
  });

  describe('Post-rollback tests', () => {
    test(
      'Wallet can sync from a serialized state and balance and txHistory match @healthcheck @rollback',
      async () => {
        allure.tag('smoke');
        allure.tms('PM-11394', 'PM-11394');
        allure.epic('Headless wallet');
        allure.feature('Hard Forks');
        allure.story('Restore from serialized state pre-HF');
        // const fixture = getFixture();
        // wallet = await WalletBuilder.buildFromSeed(
        //   fixture.getIndexerUri(),
        //   fixture.getIndexerWsUri(),
        //   fixture.getProverUri(),
        //   fixture.getNodeUri(),
        //   seed,
        //   'info',
        // );
        // wallet.start();
        // wallet = await WalletBuilder.buildFromSeed(
        //   'http://localhost:8088',
        //   'ws://localhost:8088',
        //   'http://localhost:6300',
        //   'http://localhost:9944',
        //   seed,
        //   'info',
        // );
        // wallet.start();
        // const state = await waitForSync(wallet);
        // const serialized = await wallet.serializeState();
        // // logger.info(serialized);
        // const stateObject = JSON.parse(serialized);
        // // expect(stateObject.txHistory).toHaveLength(1);
        // expect(stateObject.offset).toBeGreaterThan(0);
        // expect(typeof stateObject.state).toBe('string');
        // expect(stateObject.state).toBeTruthy();
        // await wallet.close();

        // writeFileSync('res/undeployedHF.state', serialized, {
        //   flag: 'w',
        // });

        const restoredWallet = await WalletBuilderPostHF.restore(
          'http://localhost:8088',
          'ws://localhost:8088',
          'http://localhost:6300',
          'http://localhost:9944',
          serialized,
          'info',
        );
        restoredWallet.start();
        const newState = await waitForSync(restoredWallet);
        // compareStates(newState, state);
        // expect(newState.syncProgress?.total).toBeGreaterThanOrEqual(state.syncProgress?.total ?? 0n);
        // const serializedPost = await restoredWallet.serializeState();
        // writeFileSync('res/undeployedHFpost.state', serializedPost, {
        //   flag: 'w',
        // });
        expect(newState.balances).toEqual(expectedBalance);
        expect(normalizeWalletState(newState).normalized).toEqual(expectedTxHistory);

        await closeWallet(restoredWallet);
      },
      timeout,
    );

    test(
      'Wallet can transact after rollback @healthcheck @rollback',
      async () => {
        allure.tag('healthcheck');
        allure.tms('PM-11392', 'PM-11392');
        allure.epic('Headless wallet');
        allure.feature('Hard Forks');
        allure.story('Submitting a valid transaction post-rollback');

        const preHFWallet = await WalletBuilderPreHF.buildFromSeed(
          'http://localhost:8088',
          'ws://localhost:8088',
          'http://localhost:6300',
          'http://localhost:9944',
          seedSender,
          NetworkIdPreHf.Undeployed,
          'info',
          true, // because we're completely skipping version combinator, we need to ignore transaction history
        );

        const preHFSerializedState = await preHFWallet.serializeState();
        console.log('pre hf serialized state', preHFSerializedState.slice(0, 100));

        wallet = await WalletBuilderPostHF.restore(
          'http://localhost:8088',
          'ws://localhost:8088',
          'http://localhost:6300',
          'http://localhost:9944',
          preHFSerializedState,
          'info',
          false,
        );
        wallet.start();

        console.log('GOT AFTER HF WALLET!');

        const state = await waitForSync(wallet);

        console.log('State after HF', state.syncProgress);

        expect(state.syncProgress?.synced).toBeGreaterThan(0);
        expect(state.balances).toEqual(expectedBalanceSender);
        // expect(normalizeWalletState(state).normalized).toEqual(expectedTxHistorySender);

        const outputsToCreate = [
          {
            type: nativeTokenHash,
            amount: outputValue,
            receiverAddress: state.address,
          },
        ];
        const txToProve = await wallet.transferTransaction(outputsToCreate);
        const provenTx = await wallet.proveTransaction(txToProve);
        const txId = await wallet.submitTransaction(provenTx);
        logger.info('Transaction id: ' + txId);

        await waitForTxInHistory(txId, wallet);
        await waitForIndex(wallet, 33);
        const serializedPostNew = await wallet.serializeState();
        logger.info(serializedPostNew);
        writeFileSync('res/undeployedSentPostHf.state', serializedPostNew, {
          flag: 'w',
        });
        const walletPost = await WalletBuilderPostHF.restore(
          'http://localhost:8088',
          'ws://localhost:8088',
          'http://localhost:6300',
          'http://localhost:9944',
          serializedPostNew,
          'info',
          true,
        );
        walletPost.start();
        const finalState = await waitForSync(wallet);
        logger.info(finalState.transactionHistory);
        logger.info(walletStateTrimmed(finalState));
        logger.info(`Wallet 1 available coins: ${finalState.availableCoins.length}`);
        logger.info(`Wallet 1 tDUST: ${finalState.balances[nativeToken()]}`);
        logger.info(`Wallet 1 native token 1: ${finalState.balances[nativeTokenHash]}`);
        expect(finalState.transactionHistory.length).toBe(3);
        expect(finalState.availableCoins.length).toBeGreaterThan(state.availableCoins.length);
        const serializedPost = await wallet.serializeState();
        logger.info(serializedPost.slice(0, 100));
        const stateObject = JSON.parse(serializedPost);
        expect(stateObject.txHistory).toHaveLength(3);
        expect(stateObject.protocolVersion).toEqual(1);

        await closeWallet(wallet);
        await closeWallet(walletPost);
      },
      timeout,
    );
  });
});

async function waitForProtocolAtIndexer(expectedValue: number, timeout: number = 10_000) {
  const startTime = Date.now();

  return await new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      const value = await queryIndexerForProtocolVersion();

      logger.info(`Protocol Version: ${value}`);
      if (value === expectedValue) {
        clearInterval(interval);
        resolve(value);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(interval);

        reject(new Error(`Timeout: Expected ${expectedValue} but got ${value}`));
      }
    }, 5000);
  });
}

async function queryIndexerForProtocolVersion(): Promise<number | undefined> {
  const result = await fetch('http://localhost:8088/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: '{ block { protocolVersion } }' }),
  });
  const version = parseInt((await result.json()).data.block.protocolVersion);
  return version;
}
