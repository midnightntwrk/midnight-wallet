import * as w from '@midnight-ntwrk/wallet';
import * as zswap from '@midnight-ntwrk/zswap';
import * as process from 'process';
import * as rxjs from 'rxjs';
import * as assert from 'node:assert/strict';
import { DockerComposeEnvironment, Wait } from 'testcontainers';
import * as path from 'node:path';
import { ShieldedEncryptionSecretKey } from '@midnight-ntwrk/wallet-sdk-address-format';

const currentFile = new URL(import.meta.url).pathname;
const composePath = path.resolve(currentFile, '../../../../typescript/packages/e2e-tests');
const environment = await new DockerComposeEnvironment(composePath, 'docker-compose.yml')
  .withWaitStrategy('proof-server-1', Wait.forLogMessage('Actix runtime found; starting in Actix runtime'))
  .withWaitStrategy('node-1', Wait.forListeningPorts())
  .withWaitStrategy('indexer-1', Wait.forLogMessage(/block indexed/))
  .up();

const networkId = w.NetworkId.fromJs(zswap.NetworkId.Undeployed);
const secretKeys = zswap.SecretKeys.fromSeed(
  Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex'),
);

const localState = new zswap.LocalState();
const wallet = w.CoreWallet.emptyV1(localState, secretKeys, networkId);
const syncCapability = new w.DefaultSyncCapability(
  new w.DefaultTxHistoryCapability(),
  w.V1Transaction,
  w.V1EvolveState,
);

const tracer = w.TracerCarrier.createLoggingTracer('debug');
const allocatedClient = await w.IndexerClient.create('ws://localhost:8088/api/v1/graphql/ws', tracer).allocate();

const bech32mESK = ShieldedEncryptionSecretKey.codec
  .encode(zswap.NetworkId.Undeployed, new ShieldedEncryptionSecretKey(wallet.secretKeys.encryptionSecretKey))
  .asString();

const syncService = w.DefaultSyncService.create(allocatedClient.value, bech32mESK, void 0);

const syncedWallet = await rxjs.lastValueFrom(
  syncService.sync$().pipe(
    rxjs.concatMap((update) => w.V1Combination.mapIndexerEvent(update, networkId)),
    rxjs.scan((wallet, update) => {
      return w.JsEither.fold(
        syncCapability.applyUpdate(wallet, update),
        (error) => {
          throw error;
        },
        (wallet) => wallet,
      );
    }, wallet),
    rxjs.takeWhile((wallet) => {
      return !(wallet.isConnected && wallet.progress.isComplete);
    }, true),
  ),
);

const balances = [...syncedWallet.state.coins].reduce((acc: Record<string, bigint>, coin) => {
  return {
    ...acc,
    [coin.type]: acc[coin.type] === undefined ? coin.value : acc[coin.type] + coin.value,
  };
}, {});

try {
  assert.deepEqual(balances, {
    '02000000000000000000000000000000000000000000000000000000000000000000': 25000000000000000n,
    '02000000000000000000000000000000000000000000000000000000000000000001': 5000000000000000n,
    '02000000000000000000000000000000000000000000000000000000000000000002': 5000000000000000n,
  });
  console.log('Success');
  process.exit(0);
} catch (e) {
  console.error('Failure');
  console.error(e);
  process.exit(1);
} finally {
  await allocatedClient.deallocate();
  await environment.down();
}
