import '../gen/augment-api.js';

import { ApiPromise, SubmittableResult, WsProvider } from '@polkadot/api';
import {
  Duration,
  Effect,
  Either,
  Layer,
  ParseResult,
  pipe,
  Schedule,
  Schema,
  Scope,
  Stream,
  StreamEmit,
} from 'effect';
import * as NodeClient from './NodeClient.js';
import * as SubmissionEvent from './SubmissionEvent.js';
import * as NodeClientError from './NodeClientError.js';
import BN from 'bn.js';
import { u8aToHex } from '@polkadot/util';

export type Config = {
  nodeURL: URL;
  reconnectionTimeout: Duration.Duration;
  reconnectionDelay: Duration.Duration;
};

export const DEFAULT_CONFIG = {
  reconnectionTimeout: Duration.infinity,
  reconnectionDelay: Duration.seconds(1),
};

export const makeConfig = (input: Partial<Config> & Pick<Config, 'nodeURL'>): Config => ({
  ...DEFAULT_CONFIG,
  ...input,
});

export class PolkadotNodeClient implements NodeClient.Service {
  static make(
    configInput: Partial<Config> & Pick<Config, 'nodeURL'>,
  ): Effect.Effect<PolkadotNodeClient, NodeClientError.NodeClientError, Scope.Scope> {
    const config = makeConfig(configInput);
    return Effect.acquireRelease(
      Effect.promise(() =>
        ApiPromise.create({
          // @ts-expect-error -- exactOptionalPropertyTypes cause an incompatibility here
          provider: new WsProvider(config.nodeURL.toString()),
          throwOnConnect: false,
        }),
      ),
      (api) => Effect.promise(() => api.disconnect()),
    ).pipe(Effect.map((api) => new PolkadotNodeClient(config, api)));
  }

  static layer(
    configInput: Partial<Config> & Pick<Config, 'nodeURL'>,
  ): Layer.Layer<NodeClient.NodeClient, NodeClientError.NodeClientError, Scope.Scope> {
    return Layer.effect(NodeClient.NodeClient, PolkadotNodeClient.make(configInput));
  }

  readonly config: Config;
  readonly api: ApiPromise;

  constructor(config: Config, api: ApiPromise) {
    this.config = config;
    this.api = api;
  }

  ensureConnection(): Effect.Effect<void, NodeClientError.NodeClientError> {
    return pipe(
      Effect.promise(async () => {
        if (!this.api.isConnected) {
          await this.api.connect();
        }
      }),
      Effect.andThen(Effect.sync(() => this.api.isConnected)),
      Effect.repeat({
        until: (value) => value,
        schedule: Schedule.spaced(this.config.reconnectionDelay),
      }),
      Effect.timeout(this.config.reconnectionTimeout),
      Effect.asVoid,
      Effect.mapError(
        (timeout) =>
          new NodeClientError.ConnectionError({
            message: 'Could not connect within specified time range (5s)',
            cause: timeout,
          }),
      ),
    );
  }

  sendMidnightTransaction(
    serializedTransaction: NodeClient.SerializedMnTransaction,
  ): Stream.Stream<SubmissionEvent.SubmissionEvent, NodeClientError.NodeClientError> {
    const outputStream: Stream.Stream<SubmissionEvent.SubmissionEvent, NodeClientError.NodeClientError> = Stream.async(
      (emit) => {
        const callUnsubscribe = () => unsubscribeP.then((thunk) => thunk());
        const unsubscribeP: Promise<() => void> = this.api.tx.midnight
          .sendMnTransaction(u8aToHex(serializedTransaction))
          .send(this.#handleSubmissionResult(serializedTransaction, emit, callUnsubscribe))
          .catch((err) => {
            return emit
              .fail(
                new NodeClientError.SubmissionError({
                  message: 'Transaction submission failed',
                  txData: serializedTransaction,
                  cause: err,
                }),
              )
              .then(() => () => {});
          });

        return Effect.promise(callUnsubscribe);
      },
    );

    return pipe(
      Stream.fromEffect(this.ensureConnection()),
      Stream.flatMap(() => outputStream),
    );
  }

  getGenesis(): Effect.Effect<
    { readonly transactions: readonly NodeClient.SerializedMnTransaction[] },
    NodeClientError.NodeClientError
  > {
    return Effect.promise(() => this.api.rpc.chain.getBlock(this.api.genesisHash)).pipe(
      Effect.map((block) => {
        // https://polkadot.js.org/docs/api/cookbook/blocks/#how-do-i-view-extrinsic-information
        return {
          transactions: block.block.extrinsics
            .filter(
              (extrinsic) => extrinsic.method.section === 'midnight' && extrinsic.method.method === 'sendMnTransaction',
            )
            .map((extrinsic) => extrinsic.method.args[0].toU8a()),
        };
      }),
      Effect.mapError(
        (error) =>
          new NodeClientError.ConnectionError({
            message: 'Failed to retrieve genesis transactions',
            cause: error,
          }),
      ),
    );
  }

  #handleSubmissionResult = (
    serializedTransaction: NodeClient.SerializedMnTransaction,
    emit: StreamEmit.Emit<never, NodeClientError.NodeClientError, SubmissionEvent.SubmissionEvent, void>,
    unsubscribe: () => Promise<void>,
  ) => {
    const WithBNBlockNumber = Schema.Struct({
      blockNumber: Schema.instanceOf(BN),
    });

    const emitParseError = (error: ParseResult.ParseError) =>
      emit.fail(
        new NodeClientError.ParseError({
          message: 'Failed to parse result provided by node',
          cause: error,
        }),
      );
    const decodeBlockNumber = Schema.decodeUnknownEither(WithBNBlockNumber, {
      errors: 'all',
      onExcessProperty: 'ignore',
    });

    return async (result: SubmittableResult) => {
      //Here's a detailed documentation about the result: https://github.com/paritytech/polkadot-sdk/blob/9b4cfe66188aa6f4408ca0463d373f0121bc1a8c/substrate/client/transaction-pool/api/src/lib.rs#L132
      const status = result.status;

      if (status.isReady || status.isFuture || status.isBroadcast || status.isRetracted) {
        // The retracted status means the original block was rolled back, so transaction went back to mempool
        await emit.single(SubmissionEvent.Submitted({ tx: serializedTransaction, txHash: result.txHash.toString() }));
      } else if (status.isInBlock) {
        await pipe(
          decodeBlockNumber(result),
          Either.match({
            onLeft: emitParseError,
            onRight: (parsed: { blockNumber: BN }) => {
              return emit.single(
                SubmissionEvent.InBlock({
                  tx: serializedTransaction,
                  blockHash: status.asInBlock.toString(),
                  blockHeight: BigInt(parsed.blockNumber.toString(10)),
                  txHash: result.txHash.toString(),
                }),
              );
            },
          }),
        );
      } else if (status.isFinalized) {
        await pipe(
          decodeBlockNumber(result),
          Either.match({
            onLeft: emitParseError,
            onRight: (parsed: { blockNumber: BN }) => {
              return emit.single(
                SubmissionEvent.Finalized({
                  tx: serializedTransaction,
                  blockHash: status.asFinalized.toString(),
                  blockHeight: BigInt(parsed.blockNumber.toString(10)),
                  txHash: result.txHash.toString(),
                }),
              );
            },
          }),
        );
        await emit.end();
        await unsubscribe();
      } else if (status.isFinalityTimeout) {
        await emit.fail(
          new NodeClientError.TransactionProgressError({
            message: 'Transaction did not reach finality within expected time, likely consensus issues arised',
            desiredStage: 'Finalized',
            txData: serializedTransaction,
          }),
        );
        await unsubscribe();
      } else if (status.isUsurped) {
        await emit.fail(
          new NodeClientError.TransactionUsurpedError({
            message:
              'Transaction got usurped (replaced by another one matching its discriminators like sender or nonce)',
            txData: serializedTransaction,
          }),
        );
        await unsubscribe();
      } else if (status.isDropped) {
        await emit.fail(
          new NodeClientError.TransactionDroppedError({
            message: 'Transaction got dropped, the mempool likely is full and network congested',
            txData: serializedTransaction,
          }),
        );
        await unsubscribe();
      } else if (status.isInvalid) {
        await emit.fail(
          new NodeClientError.TransactionInvalidError({
            message: 'Transaction got dropped, the mempool likely is full and network congested',
            txData: serializedTransaction,
          }),
        );
        await unsubscribe();
      }
    };
  };
}
