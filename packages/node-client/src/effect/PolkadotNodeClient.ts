// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import '../gen/augment-api.js';

import { ApiPromise, type SubmittableResult, WsProvider } from '@polkadot/api';
import {
  Duration,
  Effect,
  Either,
  Layer,
  type ParseResult,
  pipe,
  Schedule,
  Schema,
  type Scope,
  Stream,
  type StreamEmit,
} from 'effect';
import * as NodeClient from './NodeClient.js';
import * as SubmissionEvent from './SubmissionEvent.js';
import * as NodeClientError from './NodeClientError.js';
import BN from 'bn.js';
import { u8aToHex } from '@polkadot/util';
import { SerializedTransaction } from '@midnightntwrk/wallet-sdk-abstractions';

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
      Effect.promise(async () => {
        const api = await ApiPromise.create({
          // @ts-expect-error -- exactOptionalPropertyTypes cause an incompatibility here
          provider: new WsProvider(config.nodeURL.toString()),
          throwOnConnect: false,
          noInitWarn: true,
        });
        // Disconnect immediately after loading metadata to avoid keeping the WebSocket open.
        // The health-check timer (10s interval) and timeout handler (5s interval) are cleared on disconnect.
        // Metadata and type registry remain cached in memory for subsequent on-demand connections.
        //
        // WsProvider.disconnect() is fire-and-forget: it dispatches the close frame and returns while the socket is
        // still CLOSING. `isConnected` only flips false once #onSocketClose fires, so returning here without waiting
        // leaves ensureConnection() reading a stale `true`, skipping the reconnect, and sending on a dying socket.
        // Locally the close-ack lands fast enough to hide this; against a remote node it does not.
        await new Promise<void>((resolve) => {
          if (!api.isConnected) {
            resolve();
            return;
          }
          api.once('disconnected', () => resolve());
          void api.disconnect();
        });
        return api;
      }),
      (api) => Effect.promise(() => api.disconnect()),
    ).pipe(Effect.map((api) => new PolkadotNodeClient(config, api)));
  }

  static layer(
    configInput: Partial<Config> & Pick<Config, 'nodeURL'>,
  ): Layer.Layer<NodeClient.NodeClient, NodeClientError.NodeClientError, Scope.Scope> {
    return Layer.scoped(NodeClient.NodeClient, PolkadotNodeClient.make(configInput));
  }

  readonly config: Config;
  readonly api: ApiPromise;
  /** Operations currently holding the shared connection open. */
  #activeOperations = 0;

  constructor(config: Config, api: ApiPromise) {
    this.config = config;
    this.api = api;
  }

  ensureConnection(): Effect.Effect<void, NodeClientError.NodeClientError> {
    return pipe(
      Effect.promise(async () => {
        if (!this.api.isConnected) {
          try {
            await this.api.connect();
          } catch (error) {
            // WsProvider.connect() rejects if a WebSocket already exists (connection in progress).
            // This is expected when the repeat loop re-enters before the 'open' event fires.
            if (!(error instanceof Error && error.message === 'WebSocket is already connected')) {
              throw error;
            }
          }
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
            message: `Could not establish a usable connection within ${Duration.format(
              this.config.reconnectionTimeout,
            )}`,
            cause: timeout,
          }),
      ),
    );
  }

  /** Takes a hold on the shared connection for the duration of one operation. */
  #acquire(): Effect.Effect<void, NodeClientError.NodeClientError> {
    return pipe(
      this.ensureConnection(),
      Effect.tap(() =>
        Effect.sync(() => {
          this.#activeOperations += 1;
        }),
      ),
    );
  }

  /**
   * Drops one hold, disconnecting only once the last operation finishes.
   *
   * The api instance is shared, so an unconditional `disconnect()` in a per-operation finalizer closes the transport
   * out from under any operation still in flight.
   */
  #release(): Effect.Effect<void> {
    return Effect.promise(async () => {
      this.#activeOperations = Math.max(0, this.#activeOperations - 1);
      if (this.#activeOperations === 0) {
        await this.api.disconnect();
      }
    });
  }

  sendMidnightTransaction(
    serializedTransaction: SerializedTransaction.SerializedTransaction,
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
      Stream.fromEffect(this.#acquire()),
      Stream.flatMap(() => outputStream),
      Stream.ensuring(this.#release()),
    );
  }

  getGenesis(): Effect.Effect<
    { readonly transactions: readonly SerializedTransaction.SerializedTransaction[] },
    NodeClientError.NodeClientError
  > {
    return pipe(
      this.#acquire(),
      Effect.andThen(() => Effect.promise(() => this.api.rpc.chain.getBlock(this.api.genesisHash))),
      // https://polkadot.js.org/docs/api/cookbook/blocks/#how-do-i-view-extrinsic-information
      Effect.map(({ block }) => ({
        transactions: block.extrinsics
          .filter(({ method }) => method.section === 'midnight' && method.method === 'sendMnTransaction')
          .map(({ method }) => method.args[0].toU8a())
          .map(SerializedTransaction.of),
      })),
      Effect.mapError(
        (error) =>
          new NodeClientError.ConnectionError({
            message: 'Failed to retrieve genesis transactions',
            cause: error,
          }),
      ),
      Effect.ensuring(this.#release()),
    );
  }

  #handleSubmissionResult = (
    serializedTransaction: SerializedTransaction.SerializedTransaction,
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
            message: 'Transaction is invalid and was rejected by the node',
            txData: serializedTransaction,
          }),
        );
        await unsubscribe();
      }
    };
  };
}
