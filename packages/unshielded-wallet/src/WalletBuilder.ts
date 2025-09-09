import { Effect, pipe, Stream, Layer, Deferred, Fiber, Either } from 'effect';
import { UnshieldedStateDecoder, UnshieldedStateService } from '@midnight-ntwrk/wallet-sdk-unshielded-state';
import * as ledger from '@midnight-ntwrk/ledger';
import { SyncService, UnshieldedUpdate } from './SyncService';
import { TransactionService, TokenTransfer } from './TransactionService';
import { fromStream } from './Observable';
import { createKeystore } from './KeyStore';
import { TransactionHistoryChange, TransactionHistoryService } from './TransactionHistoryService';
import { TransactionHash, TransactionHistoryEntry, TransactionHistoryStorage } from './tx-history-storage';
import { State, StateImpl } from './State';
import { NoOpTransactionHistoryStorage } from './tx-history-storage/NoOpTransactionHistoryStorage';
import { Observable } from 'rxjs';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

interface WalletConfig {
  seed: Uint8Array<ArrayBufferLike>;
  networkId: ledger.NetworkId;
  indexerUrl: string;
  txHistoryStorage?: TransactionHistoryStorage | undefined;
}

export interface UnshieldedWallet {
  start(): void;
  stop(): Promise<void>;
  serializeState(): Promise<string>;
  state: () => Observable<State>;
  transferTransaction(
    outputs: TokenTransfer[],
  ): Promise<ledger.Transaction<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding>>;
  balanceTransaction(
    tx: ledger.Transaction<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding>,
  ): Promise<ledger.Transaction<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding>>;
  signTransaction(
    tx: ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>,
  ): Promise<ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.Binding>>;
  transactionHistory:
    | undefined
    | {
        get: (item: TransactionHash) => Promise<TransactionHistoryEntry | undefined>;
        getAll: () => Observable<TransactionHistoryEntry>;
        changes: () => Observable<TransactionHistoryChange | undefined>;
      };
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
    const keyStore = createKeystore(seed, networkId);
    const bech32mAddress = keyStore.getBech32Address();

    const state = new StateImpl(unshieldedState, bech32mAddress.asString());

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
              status: update.transaction.transactionResult.status as 'SUCCESS' | 'FAILURE' | 'PARTIAL_SUCCESS',
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

    const transferTransaction = (outputs: TokenTransfer[]) =>
      Effect.gen(function* () {
        const latestState = yield* unshieldedState.getLatestState();
        if (!latestState.syncProgress) {
          return yield* Effect.fail('Unable to get the latest block number');
        }

        const mappedOutputs = outputs.map((output) => ({
          ...output,
          receiverAddress: `0200${UnshieldedAddress.codec
            .decode(ledger.NetworkId.Undeployed, MidnightBech32m.parse(output.receiverAddress))
            .data.toString('hex')}`,
        }));

        // TODO: make it configurable
        const ttl = new Date(Date.now() + latestState.syncProgress.highestTransactionId + 60 * 3600);
        const transaction = yield* transactionService.transferTransaction(mappedOutputs, ttl);
        const ledgerAddress = keyStore.getAddress();
        const publicKey = keyStore.getPublicKey();

        return yield* transactionService.balanceTransaction(transaction, unshieldedState, ledgerAddress, publicKey);
      });

    const balanceTransaction = (tx: ledger.Transaction<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding>) =>
      Effect.gen(function* () {
        const myAddress = keyStore.getAddress();
        const publicKey = keyStore.getPublicKey();
        return yield* transactionService.balanceTransaction(tx, unshieldedState, myAddress, publicKey);
      });

    const signTransaction = (tx: ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>) =>
      Effect.gen(function* () {
        const segments = transactionService.getSegments(tx);
        if (!segments.length) {
          return yield* Effect.fail('No segments found in the provided transaction');
        }

        for (const segment of segments) {
          const data = yield* transactionService.getOfferSignatureData(tx, segment);
          const signature = keyStore.signData(data);
          tx = yield* transactionService.addOfferSignature(tx, signature, segment);
        }

        return yield* transactionService.bindTransaction(tx);
      });

    const transactionHistory = txHistoryStorage
      ? {
          get: (hash: string) => Effect.runPromise(transactionHistoryService.get(hash)),
          getAll: () => fromStream(transactionHistoryService.getAll()),
          changes: () => fromStream(transactionHistoryService.changes),
        }
      : undefined;

    return {
      state: () => fromStream(state.updates()),
      start: () => {
        void Effect.runPromise(Effect.scoped(start()));
      },
      stop: () => Effect.runPromise(stop()),
      transferTransaction: (outputs: TokenTransfer[]) => Effect.runPromise(transferTransaction(outputs)),
      balanceTransaction: (tx: ledger.Transaction<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding>) =>
        Effect.runPromise(balanceTransaction(tx)),
      signTransaction: (tx: ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>) =>
        Effect.runPromise(signTransaction(tx)),
      serializeState: () => Effect.runPromise(state.serialize()),
      transactionHistory,
    };
  });

export class WalletBuilder {
  static async build({ seed, networkId, indexerUrl, txHistoryStorage }: WalletConfig): Promise<UnshieldedWallet> {
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
  }: RestorableWalletConfig): Promise<UnshieldedWallet> {
    const parsedState = JSON.parse(serializedState) as unknown;

    const decodedState = UnshieldedStateDecoder(parsedState);

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
