import { Effect, pipe, Stream, Layer, Deferred, Fiber, Either } from 'effect';
import { UnshieldedStateService } from '@midnight-ntwrk/wallet-sdk-unshielded-state';
import {
  UnshieldedWallet as UnshieldedWalletApi,
  type SerializedTransaction,
  type OutputRecipe,
  Result,
  TransactionStatus,
} from '@midnight-ntwrk/wallet-api';
import { NetworkId, type PreBinding, type PreProof, type SignatureEnabled } from '@midnight-ntwrk/ledger';
import { SyncService, UnshieldedUpdate } from './SyncService';
import { TransactionService } from './TransactionService';
import { fromStream } from './Observable';
import { createKeystore } from './KeyStore';
import { TransactionHistoryService } from './TransactionHistoryService';
import { TransactionHistoryStorage } from './tx-history-storage';
import { deserializeWalletState, serializeWalletState, toWalletState } from './Utils';
import { NoOpTransactionHistoryStorage } from './tx-history-storage/NoOpTransactionHistoryStorage';

interface Resource {
  start(): void;
  stop(): Promise<void>;
  serializeState(): Promise<string>;
}

interface WalletConfig {
  seed: string;
  networkId: (typeof NetworkId)[keyof typeof NetworkId];
  indexerUrl: string;
  txHistoryStorage?: TransactionHistoryStorage | undefined;
}

interface RestorableWalletConfig extends WalletConfig {
  serializedState: string;
}

type MakeWalletConfig = Pick<WalletConfig, 'seed' | 'networkId' | 'txHistoryStorage'>;

const makeWallet = ({ seed, networkId, txHistoryStorage }: MakeWalletConfig) =>
  Effect.gen(function* () {
    const syncService = yield* SyncService;
    const transactionHistoryService = yield* TransactionHistoryService;
    const unshieldedState = yield* UnshieldedStateService;
    const transactionService = yield* TransactionService;
    const stopLatch = yield* Deferred.make<void>();
    const keyStore = yield* createKeystore(Buffer.from(seed, 'hex'), networkId);
    const bech32mAddress = yield* keyStore.getBech32Address();

    const state = toWalletState(unshieldedState.state, bech32mAddress.asString());

    const applyUpdate = (update: UnshieldedUpdate) =>
      Effect.gen(function* () {
        const { type } = update;

        if (type === 'UnshieldedTransaction') {
          yield* unshieldedState.applyTx(update.transaction);

          yield* transactionHistoryService.create({
            id: update.transaction.id,
            hash: update.transaction.hash,
            protocolVersion: update.transaction.protocolVersion,
            identifiers: [...update.transaction.identifiers],
            transactionResult: {
              status: update.transaction.transactionResult.status as TransactionStatus,
              segments: [...(update.transaction.transactionResult.segments ?? [])],
            },
          });
        }

        if (type === 'UnshieldedTransactionsProgress') {
          yield* unshieldedState.updateSyncProgress(update.highestTransactionId);
        }
      });

    const start = () =>
      Effect.gen(function* () {
        const latestState = yield* unshieldedState.getLatestState();

        const fiber = yield* pipe(
          syncService.startSync(bech32mAddress.asString(), latestState.syncProgress?.highestTransactionId ?? 0),
          Stream.tapError((error) =>
            Effect.gen(function* () {
              yield* Effect.logError(error);
              yield* Deferred.die(stopLatch, error);
            }),
          ),
          Stream.runForEach(applyUpdate),
          Effect.fork,
        );

        yield* Deferred.await(stopLatch).pipe(Effect.tap(() => Fiber.interrupt(fiber)));
      });

    const stop = () =>
      Effect.gen(function* () {
        yield* Deferred.succeed(stopLatch, undefined);
      });

    const transferTransaction = (outputs: OutputRecipe[]) =>
      Effect.gen(function* () {
        const latestState = yield* unshieldedState.getLatestState();
        if (!latestState.syncProgress) {
          return yield* Effect.fail('Unable to get the latest block number');
        }
        // TODO: make it configurable
        const ttl = new Date(latestState.syncProgress.highestTransactionId + 60 * 60);
        const transaction = yield* transactionService.transferTransaction(outputs, ttl);
        const myAddress = yield* keyStore.getBech32Address();
        const balancedTransaction = yield* transactionService.balanceTransaction(
          transaction,
          unshieldedState,
          myAddress.asString(),
        );
        const serialized = yield* transactionService.serializeTransaction(balancedTransaction, networkId);
        return {
          success: true,
          data: serialized,
        } as Result<string>;
      });

    const balanceTransaction = (tx: SerializedTransaction) =>
      Effect.gen(function* () {
        const transaction = yield* transactionService.deserializeTransaction<SignatureEnabled, PreProof, PreBinding>(
          'signature',
          'pre-proof',
          'pre-binding',
          tx,
          networkId,
        );
        const myAddress = yield* keyStore.keystore.getAddress();
        const balanced = yield* transactionService.balanceTransaction(transaction, unshieldedState, myAddress);
        const serialized = yield* transactionService.serializeTransaction(balanced, networkId);
        return {
          success: true,
          data: serialized,
        } as Result<string>;
      });

    const signTransaction = (tx: SerializedTransaction) =>
      Effect.gen(function* () {
        let transaction = yield* transactionService.deserializeTransaction<SignatureEnabled, PreProof, PreBinding>(
          'signature',
          'pre-proof',
          'pre-binding',
          tx,
          networkId,
        );
        const segments = transactionService.getSegments(transaction);
        if (!segments.length) {
          return yield* Effect.fail('No segments found in the provided transaction');
        }
        for (const segment of segments) {
          const data = yield* transactionService.getOfferSignatureData(transaction, segment);
          const signature = yield* keyStore.keystore.signData(data);
          transaction = yield* transactionService.addOfferSignature(transaction, signature, segment);
        }
        const boundTransaction = yield* transactionService.bindTransaction(transaction);
        const serialized = yield* transactionService.serializeTransaction(boundTransaction, networkId);
        return {
          success: true,
          data: serialized,
        } as Result<string>;
      });

    const transactionHistory = txHistoryStorage
      ? {
          get: (hash: string) => Effect.runPromise(transactionHistoryService.get(hash)),
          getAll: () => fromStream(transactionHistoryService.getAll()),
          changes: () => fromStream(transactionHistoryService.changes),
        }
      : undefined;

    const serializeState = () =>
      Effect.gen(function* () {
        const state = yield* unshieldedState.getLatestState();
        return serializeWalletState(state);
      });

    return {
      state: () => fromStream(state),
      start: () => {
        void Effect.runPromise(Effect.scoped(start()));
      },
      stop: () => Effect.runPromise(stop()),
      transferTransaction: (outputs: OutputRecipe[]) => Effect.runPromise(transferTransaction(outputs)),
      balanceTransaction: (tx: SerializedTransaction) => Effect.runPromise(balanceTransaction(tx)),
      submitTransaction: () => Promise.reject(new Error('not implemented')),
      signTransaction: (tx: SerializedTransaction) => Effect.runPromise(signTransaction(tx)),
      serializeState: () => Effect.runPromise(serializeState()),
      transactionHistory,
    };
  });

export class WalletBuilder {
  static async build({
    seed,
    networkId,
    indexerUrl,
    txHistoryStorage,
  }: WalletConfig): Promise<UnshieldedWalletApi.UnshieldedWallet & Resource> {
    const txHistoryService = TransactionHistoryService.Live(
      txHistoryStorage ? txHistoryStorage : new NoOpTransactionHistoryStorage(),
    );

    const layers = Layer.mergeAll(
      SyncService.LiveWithIndexer(indexerUrl),
      UnshieldedStateService.Live(),
      TransactionService.Live,
      txHistoryService,
    );

    const walletService = makeWallet({ seed, networkId, txHistoryStorage });

    const wallet = walletService.pipe(Effect.provide(layers));

    return Effect.runPromise(wallet);
  }

  static async restore({
    seed,
    networkId,
    indexerUrl,
    serializedState,
    txHistoryStorage,
  }: RestorableWalletConfig): Promise<UnshieldedWalletApi.UnshieldedWallet & Resource> {
    const decodedState = deserializeWalletState(serializedState);

    if (Either.isLeft(decodedState)) {
      throw new Error(`Failed to decode unshielded state: ${decodedState.left.message}`);
    }

    const txHistoryService = TransactionHistoryService.Live(
      txHistoryStorage ? txHistoryStorage : new NoOpTransactionHistoryStorage(),
    );

    const layer = Layer.mergeAll(
      SyncService.LiveWithIndexer(indexerUrl),
      UnshieldedStateService.LiveWithState(decodedState.right),
      TransactionService.Live,
      txHistoryService,
    );

    const walletService = makeWallet({ seed, networkId, txHistoryStorage });

    const wallet = walletService.pipe(Effect.provide(layer));

    return Effect.runPromise(wallet);
  }
}
