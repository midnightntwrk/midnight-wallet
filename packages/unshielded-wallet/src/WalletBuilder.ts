import { Effect, pipe, Stream, Layer, Deferred, Fiber, Either, Scope } from 'effect';
import { UnshieldedStateDecoder, UnshieldedStateService } from '@midnight-ntwrk/wallet-sdk-unshielded-state';
import * as ledger from '@midnight-ntwrk/ledger';
import { SyncService, UnshieldedUpdate } from './SyncService';
import { TransactionService, TokenTransfer } from './TransactionService';
import { fromStream } from './Observable';
import { PublicKey } from './KeyStore';
import { TransactionHistoryChange, TransactionHistoryService } from './TransactionHistoryService';
import { TransactionHash, TransactionHistoryEntry, TransactionHistoryStorage } from './tx-history-storage';
import { State, StateImpl } from './State';
import { NoOpTransactionHistoryStorage } from './tx-history-storage/NoOpTransactionHistoryStorage';
import { Observable } from 'rxjs';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

interface WalletConfig {
  publicKey: PublicKey;
  networkId: ledger.NetworkId;
  indexerUrl: string;
  txHistoryStorage?: TransactionHistoryStorage | undefined;
}

export interface UnshieldedWallet {
  start(): Promise<void>;
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
    signSegment: (data: Uint8Array) => Promise<ledger.Signature>,
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

type MakeWalletConfig = Pick<WalletConfig, 'publicKey' | 'networkId' | 'txHistoryStorage'>;

const makeWallet = ({
  publicKey,
  networkId,
  txHistoryStorage,
}: MakeWalletConfig): Effect.Effect<
  UnshieldedWallet,
  never,
  SyncService | TransactionHistoryService | UnshieldedStateService | TransactionService
> =>
  Effect.gen(function* () {
    const syncService = yield* SyncService;
    const transactionHistoryService = yield* TransactionHistoryService;
    const unshieldedState = yield* UnshieldedStateService;
    const transactionService = yield* TransactionService;

    // TODO: Scope would be a preferred way to handle controlled stop
    const stopLatch = yield* Deferred.make<void>();
    const bech32mAddress = UnshieldedAddress.codec.encode(networkId, publicKey.address);

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
              // eslint-disable-next-line no-console
              yield* Effect.sync(() => console.error(error));
              yield* Deferred.die(stopLatch, error);
            }),
          ),
          Stream.runForEach(applyUpdate),
          Effect.fork,
        );

        yield* Deferred.await(stopLatch).pipe(Effect.andThen(Fiber.interrupt(fiber)));
      });

    const stop = () => Deferred.succeed(stopLatch, undefined).pipe(Effect.asVoid);

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

        return yield* transactionService.balanceTransaction(
          transaction,
          unshieldedState,
          publicKey.address.hexStringVersioned,
          publicKey.publicKey,
        );
      });

    const balanceTransaction = (tx: ledger.Transaction<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding>) =>
      transactionService.balanceTransaction(
        tx,
        unshieldedState,
        publicKey.address.hexStringVersioned,
        publicKey.publicKey,
      );

    const signTransaction = (
      tx: ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>,
      signSegment: (data: Uint8Array) => Effect.Effect<ledger.Signature, Error>,
    ) =>
      Effect.gen(function* () {
        const segments = transactionService.getSegments(tx);
        if (!segments.length) {
          return yield* Effect.fail('No segments found in the provided transaction');
        }

        for (const segment of segments) {
          const data = yield* transactionService.getOfferSignatureData(tx, segment);
          const signature = yield* signSegment(data);
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

    const result: UnshieldedWallet = {
      state: () => fromStream(state.updates()),
      start: () => {
        return new Promise((resolve) => {
          Effect.runFork(Effect.scoped(start()));
          resolve(void 0);
        });
      },
      stop: () => Effect.runPromise(stop()),
      transferTransaction: (outputs: TokenTransfer[]) => Effect.runPromise(transferTransaction(outputs)),
      balanceTransaction: (tx: ledger.Transaction<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding>) =>
        Effect.runPromise(balanceTransaction(tx)),
      signTransaction: (
        tx: ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>,
        signSegment: (data: Uint8Array) => Promise<ledger.Signature>,
      ) => Effect.runPromise(signTransaction(tx, (data) => Effect.tryPromise(() => signSegment(data)))),
      serializeState: () => Effect.runPromise(state.serialize()),
      transactionHistory,
    };

    return result;
  });

export class WalletBuilder {
  static async build({ publicKey, networkId, indexerUrl, txHistoryStorage }: WalletConfig): Promise<UnshieldedWallet> {
    const txHistoryService = TransactionHistoryService.Live(
      txHistoryStorage ? txHistoryStorage : new NoOpTransactionHistoryStorage(),
    );

    const layers = Layer.mergeAll(
      SyncService.LiveWithIndexer(indexerUrl),
      UnshieldedStateService.Live(),
      TransactionService.Live,
      txHistoryService,
    );

    const walletService = makeWallet({ publicKey, networkId, txHistoryStorage });

    const wallet = walletService.pipe(Effect.provide(layers));

    return Effect.runPromise(wallet);
  }

  static async restore({
    publicKey,
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

    const walletService = makeWallet({ publicKey, networkId, txHistoryStorage });

    const wallet = walletService.pipe(Effect.provide(layer));

    return Effect.runPromise(wallet);
  }
}
