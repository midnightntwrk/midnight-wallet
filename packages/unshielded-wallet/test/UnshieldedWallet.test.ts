import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import path from 'path';
import { filter, firstValueFrom } from 'rxjs';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WalletBuilder } from '../src/index.js';
import { createKeystore, PublicKey } from '../src/KeyStore.js';
import { InMemoryTransactionHistoryStorage } from '../src/tx-history-storage/InMemoryTransactionHistoryStorage.js';
import { getUnshieldedSeed } from './testUtils.js';

vi.setConfig({ testTimeout: 100_000, hookTimeout: 100_000 });

const currentFile = new URL(import.meta.url).pathname;
const environmentUID = Math.floor(Math.random() * 1000).toString();
const environment = new DockerComposeEnvironment(path.resolve(currentFile, '..'), 'docker-compose.yml')
  .withWaitStrategy(`node_${environmentUID}`, Wait.forListeningPorts())
  .withWaitStrategy(`indexer_${environmentUID}`, Wait.forListeningPorts())
  .withEnvironment({ TESTCONTAINERS_UID: environmentUID });

describe('UnshieldedWallet', () => {
  let indexerPort: number;
  let startedEnvironment: StartedDockerComposeEnvironment;
  const unshieldedSeed = getUnshieldedSeed('0000000000000000000000000000000000000000000000000000000000000001');

  beforeAll(async () => {
    startedEnvironment = await environment.up();
    indexerPort = startedEnvironment.getContainer(`indexer_${environmentUID}`).getMappedPort(8088);
  });

  it('should build', async () => {
    const txHistoryStorage = new InMemoryTransactionHistoryStorage();
    const keystore = createKeystore(unshieldedSeed, NetworkId.NetworkId.Undeployed);

    const wallet = await WalletBuilder.build({
      indexerUrl: `ws://localhost:${indexerPort}/api/v3/graphql/ws`,
      publicKey: PublicKey.fromKeyStore(keystore),
      networkId: NetworkId.NetworkId.Undeployed,
      txHistoryStorage,
    });

    await wallet.start();

    const state = await firstValueFrom(
      wallet.state().pipe(filter((state) => state.syncProgress?.synced === true && state.availableCoins.length > 0)),
    );

    expect(state.address).toBe('mn_addr_undeployed1h3ssm5ru2t6eqy4g3she78zlxn96e36ms6pq996aduvmateh9p9sk96u7s');
    expect(state.balances.size).toBeGreaterThan(0);
    expect(state.pendingCoins.length).toBe(0);
    expect(state.syncProgress).toBeDefined();

    await wallet.stop();
  });

  it('should restore from serialized state with tx history', async () => {
    const txHistoryStorage = new InMemoryTransactionHistoryStorage();
    const keystore = createKeystore(unshieldedSeed, NetworkId.NetworkId.Undeployed);

    const initialWallet = await WalletBuilder.build({
      indexerUrl: `ws://localhost:${indexerPort}/api/v3/graphql/ws`,
      publicKey: PublicKey.fromKeyStore(keystore),
      networkId: NetworkId.NetworkId.Undeployed,
      txHistoryStorage,
    });

    await initialWallet.start();

    const initialState = await firstValueFrom(
      initialWallet
        .state()
        .pipe(filter((state) => state.syncProgress?.synced === true && state.availableCoins.length > 0)),
    );

    expect(initialState.syncProgress).toBeDefined();
    expect(initialState.syncProgress?.applyGap).toBe(0);

    const serializedState = await initialWallet.serializeState();

    const serializedTxHistory = txHistoryStorage.serialize();

    await initialWallet.stop();

    const restoredTxHistoryStorage = InMemoryTransactionHistoryStorage.fromSerialized(serializedTxHistory);

    const restoredWallet = await WalletBuilder.restore({
      indexerUrl: `ws://localhost:${indexerPort}/api/v3/graphql/ws`,
      publicKey: PublicKey.fromKeyStore(keystore),
      networkId: NetworkId.NetworkId.Undeployed,
      serializedState,
      txHistoryStorage: restoredTxHistoryStorage,
    });

    const restoredState = await firstValueFrom(restoredWallet.state());

    expect(restoredState.address).toBe(initialState.address);
    expect(restoredState.balances.size).toBeGreaterThan(0);
    expect(restoredState.pendingCoins.length).toBe(0);
    expect(restoredState.syncProgress).toBeDefined();
    expect(restoredState.syncProgress?.applyGap).toBe(0);
    expect(restoredState.syncProgress?.synced).toBe(true);

    await restoredWallet.stop();
  });

  it('should instantiate without transaction history service', async () => {
    const keystore = createKeystore(unshieldedSeed, NetworkId.NetworkId.Undeployed);
    const wallet = await WalletBuilder.build({
      indexerUrl: `ws://localhost:${indexerPort}/api/v3/graphql/ws`,
      publicKey: PublicKey.fromKeyStore(keystore),
      networkId: NetworkId.NetworkId.Undeployed,
    });

    await wallet.start();

    await firstValueFrom(
      wallet.state().pipe(filter((state) => state.syncProgress?.synced === true && state.availableCoins.length > 0)),
    );
    expect(wallet.transactionHistory).toBeUndefined();

    await wallet.stop();
  });

  afterAll(async () => {
    if (startedEnvironment) {
      await startedEnvironment.down();
    }
  });

  it('should restore from serialized state', async () => {
    const keystore = createKeystore(unshieldedSeed, NetworkId.NetworkId.Undeployed);
    const initialWallet = await WalletBuilder.build({
      indexerUrl: `ws://localhost:${indexerPort}/api/v3/graphql/ws`,
      publicKey: PublicKey.fromKeyStore(keystore),
      networkId: NetworkId.NetworkId.Undeployed,
    });

    await initialWallet.start();

    const initialState = await firstValueFrom(
      initialWallet
        .state()
        .pipe(filter((state) => state.syncProgress?.synced === true && state.availableCoins.length > 0)),
    );

    expect(initialState.syncProgress).toBeDefined();
    expect(initialState.syncProgress?.applyGap).toBe(0);

    const serializedState = await initialWallet.serializeState();

    await initialWallet.stop();

    const restoredWallet = await WalletBuilder.restore({
      indexerUrl: `ws://localhost:${indexerPort}/api/v3/graphql/ws`,
      publicKey: PublicKey.fromKeyStore(keystore),
      networkId: NetworkId.NetworkId.Undeployed,
      serializedState,
    });

    const restoredState = await firstValueFrom(restoredWallet.state());

    expect(restoredState.address).toBe(initialState.address);
    expect(restoredState.balances.size).toBeGreaterThan(0);
    expect(restoredState.pendingCoins.length).toBe(0);
    expect(restoredState.syncProgress).toBeDefined();
    expect(restoredState.syncProgress?.applyGap).toBe(0);
    expect(restoredState.syncProgress?.synced).toBe(true);

    await restoredWallet.stop();
  });
});
