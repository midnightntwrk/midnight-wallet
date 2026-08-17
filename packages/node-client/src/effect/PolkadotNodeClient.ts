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
  Ref,
  Schedule,
  Schema,
  type Scope,
  Stream,
  SynchronizedRef,
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

/**
 * How many consecutive readiness probes may fail on a connected socket before the failure is surfaced.
 *
 * @remarks
 *   Small, because each failure on a connected socket already says the node is answering the transport but not RPC — more
 *   retries only delay the verdict. Three tolerates a probe racing a reconnect that has not finished re-initialising,
 *   without letting a genuinely broken node hide behind an unbounded retry loop.
 */
const MAX_CONNECTED_PROBE_FAILURES = 3;

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

    // A finite `reconnectionTimeout` is a caller asking to be told when the node cannot be reached. Honouring it here as
    // well as in `ensureConnection` is what makes that possible: left to its defaults, `WsProvider` retries on a timer
    // and `throwOnConnect: false` means `ApiPromise.create` waits for a connection that may never arrive.
    const isBounded = Duration.isFinite(config.reconnectionTimeout);

    // The bound is enforced inside the promise rather than with `Effect.timeout`, because `Effect.acquireRelease` runs
    // its acquire uninterruptibly — deliberately, so a resource cannot be acquired and then leaked — and an
    // uninterruptible region ignores an outer timeout. Racing here also lets the half-open provider be closed, which an
    // interruption could not do.
    const connect = Effect.tryPromise(async () => {
      // `autoConnectMs` keeps its default deliberately. Passing `false` does not mean "connect once without retrying" —
      // it means "do not connect at all", leaving `ApiPromise.create` waiting on a connection nobody started. The bound
      // below is what limits the wait; the provider's own retry behaviour is left alone.
      const provider = new WsProvider(config.nodeURL.toString());

      const created = ApiPromise.create({
        // @ts-expect-error -- exactOptionalPropertyTypes cause an incompatibility here
        provider,
        // Surfacing a connection error rather than retrying past it, but only for a caller that asked to be bounded.
        throwOnConnect: isBounded,
        noInitWarn: true,
      });

      // Clamped to the largest delay `setTimeout` honours: a delay of 2^31ms or more overflows and fires after ~1ms,
      // which turned a generous bound such as 30 days into an instant failure on every connection attempt. A bound
      // that large behaves as "still waiting" on any human timescale, so the clamp loses nothing.
      const timeoutMillis = Math.min(Duration.toMillis(config.reconnectionTimeout), 2 ** 31 - 1);
      // Held so the timer can be cleared once the race settles. Left armed, it keeps Node's event loop alive, so a
      // short-lived process that reads once cannot exit until it fires.
      const timer: { handle?: ReturnType<typeof setTimeout> } = {};

      const api = isBounded
        ? await Promise.race([
            created,
            new Promise<never>((_resolve, reject) => {
              timer.handle = setTimeout(() => reject(new Error(`Timed out after ${timeoutMillis}ms`)), timeoutMillis);
            }),
          ])
            .catch(async (error: unknown) => {
              // Without this the provider keeps retrying on its timer for the lifetime of the process.
              await provider.disconnect().catch(() => undefined);
              throw error;
            })
            .finally(() => {
              if (timer.handle !== undefined) clearTimeout(timer.handle);
            })
        : await created;

      // Disconnect immediately after loading metadata to avoid keeping the WebSocket open.
      // The health-check timer (10s interval) and timeout handler (5s interval) are cleared on disconnect.
      // Metadata and type registry remain cached in memory for subsequent on-demand connections.
      await api.disconnect();
      return api;
    });

    return Effect.acquireRelease(
      // `tryPromise` rather than `promise`: a rejected connection has to reach the error channel this method already
      // declares, instead of arriving as a defect that no `catchTag` can handle.
      connect.pipe(
        Effect.mapError(
          (cause) =>
            new NodeClientError.ConnectionError({
              message: `Could not connect to ${config.nodeURL.toString()}`,
              cause,
            }),
        ),
      ),
      (api) => Effect.promise(() => api.disconnect()),
    ).pipe(
      Effect.flatMap((api) =>
        SynchronizedRef.make(0).pipe(Effect.map((activeCalls) => new PolkadotNodeClient(config, api, activeCalls))),
      ),
    );
  }

  static layer(
    configInput: Partial<Config> & Pick<Config, 'nodeURL'>,
  ): Layer.Layer<NodeClient.NodeClient, NodeClientError.NodeClientError, Scope.Scope> {
    return Layer.scoped(NodeClient.NodeClient, PolkadotNodeClient.make(configInput));
  }

  readonly config: Config;
  readonly api: ApiPromise;
  /**
   * How many calls are in flight on this instance's shared `api`.
   *
   * @remarks
   *   Every method used to end with an unconditional disconnect of the one shared socket, so interleaving any two calls
   *   on the same instance let whichever finished first tear the socket down under the other — an in-flight
   *   submission's status subscription being the costly case. The count makes the disconnect conditional: each call
   *   registers before it connects and deregisters when it finishes, and only the last one out releases the socket.
   *   `SynchronizedRef` serialises the transitions, so a call arriving while the last one is disconnecting waits, then
   *   reconnects through `ensureConnection`.
   */
  readonly #activeCalls: SynchronizedRef.SynchronizedRef<number>;

  constructor(config: Config, api: ApiPromise, activeCalls: SynchronizedRef.SynchronizedRef<number>) {
    this.config = config;
    this.api = api;
    this.#activeCalls = activeCalls;
  }

  /** Registers one call on the shared connection. Must be balanced by {@link PolkadotNodeClient.#deregister}. */
  #register(): Effect.Effect<void> {
    return SynchronizedRef.update(this.#activeCalls, (active) => active + 1);
  }

  /** Deregisters one call, disconnecting the shared socket when it was the last one in flight. */
  #deregister(): Effect.Effect<void> {
    return SynchronizedRef.updateEffect(this.#activeCalls, (active) =>
      active === 1 ? Effect.promise(() => this.api.disconnect()).pipe(Effect.as(0)) : Effect.succeed(active - 1),
    );
  }

  ensureConnection(): Effect.Effect<void, NodeClientError.NodeClientError> {
    // The counter distinguishes "the node is not there yet" from "the node is there and broken". Failures while the
    // socket is down retry without limit — that is the unbounded caller's contract, and what submission relies on.
    // Failures while the socket reports connected are a verdict about the node, and surfacing them restores the loud
    // failure this method's probe had silently absorbed: before the probe existed, such a node failed on the first
    // real call; with the probe swallowing every error, it span the retry loop forever under the default (infinite)
    // reconnectionTimeout.
    return Ref.make(0).pipe(
      Effect.flatMap((connectedProbeFailures) =>
        pipe(
          // `tryPromise` + swallow, not `Effect.promise`: a rejected connect() inside `Effect.promise` is a defect that
          // bypasses the typed ConnectionError mapping below and kills the caller's fibre as a crash. A rejection here
          // is one failed attempt, not a verdict — the probe below decides usability and the schedule retries, with
          // the surrounding timeout as the overall bound. This also covers WsProvider's rejection when a WebSocket
          // already exists (a connection in progress), which the repeat loop routinely races into.
          Effect.tryPromise(async () => {
            if (!this.api.isConnected) {
              await this.api.connect();
            }
          }),
          Effect.catchAll(() => Effect.void),
          // Readiness is established by making a call, not by reading `isConnected`. That flag goes true when the
          // socket opens, which is earlier than the api can serve requests: after `make()` disconnects to release the
          // socket, a reconnect has to re-initialise the runtime metadata and subscriptions, and any `api.rpc` call
          // issued in the gap fails with a disconnection. A trivial call is the only honest test of "usable".
          Effect.andThen(
            Effect.tryPromise(() => this.api.rpc.system.chain()).pipe(
              Effect.zipLeft(Ref.set(connectedProbeFailures, 0)),
              Effect.as(true),
              Effect.catchAll((probeError) =>
                this.api.isConnected
                  ? Ref.updateAndGet(connectedProbeFailures, (failures) => failures + 1).pipe(
                      Effect.flatMap((failures) =>
                        failures >= MAX_CONNECTED_PROBE_FAILURES
                          ? Effect.fail(
                              new NodeClientError.ConnectionError({
                                message: 'Node accepted the connection but repeatedly failed to answer RPC',
                                cause: probeError,
                              }),
                            )
                          : Effect.succeed(false),
                      ),
                    )
                  : // A failed probe on a closed socket says nothing beyond "not connected yet" — reset, keep waiting.
                    Ref.set(connectedProbeFailures, 0).pipe(Effect.as(false)),
              ),
            ),
          ),
          Effect.repeat({
            until: (usable) => usable,
            schedule: Schedule.spaced(this.config.reconnectionDelay),
          }),
          Effect.timeout(this.config.reconnectionTimeout),
          Effect.asVoid,
          // `catchTag`, not `mapError`: the probe's ConnectionError must pass through unwrapped, so the caller sees
          // "node answered the socket but not RPC" rather than a second ConnectionError blaming the timeout.
          Effect.catchTag(
            'TimeoutException',
            (timeout) =>
              new NodeClientError.ConnectionError({
                message: 'Could not connect before the configured reconnectionTimeout elapsed',
                cause: timeout,
              }),
          ),
        ),
      ),
    );
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
      Stream.acquireRelease(this.#register(), () => this.#deregister()),
      Stream.flatMap(() => Stream.fromEffect(this.ensureConnection())),
      Stream.flatMap(() => outputStream),
    );
  }

  getGenesis(): Effect.Effect<
    { readonly transactions: readonly SerializedTransaction.SerializedTransaction[] },
    NodeClientError.NodeClientError
  > {
    return Effect.acquireUseRelease(
      this.#register(),
      () =>
        pipe(
          this.ensureConnection(),
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
        ),
      () => this.#deregister(),
    );
  }

  getGenesisHash(): Effect.Effect<string, NodeClientError.NodeClientError> {
    // Answered from the api rather than the chain: `ApiPromise.create` fetched the genesis hash once and caches it, so
    // this read needs neither a connection nor the register/deregister dance the RPC-backed calls run.
    return Effect.sync(() => this.api.genesisHash.toString());
  }

  getFinalizedBlock(): Effect.Effect<NodeClient.FinalizedBlock, NodeClientError.NodeClientError> {
    return Effect.acquireUseRelease(
      this.#register(),
      () =>
        pipe(
          this.ensureConnection(),
          Effect.andThen(() =>
            // `tryPromise` rather than `promise`: an unreachable node has to surface as a typed failure the periodic
            // liveness check can handle, not as a defect that tears the caller's fiber down.
            Effect.tryPromise(async () => {
              // The header must be read at the finalized head's hash. `getHeader()` with no argument returns the best
              // block, whose height may not be finalized yet.
              const hash = await this.api.rpc.chain.getFinalizedHead();
              const header = await this.api.rpc.chain.getHeader(hash.toString());
              return { hash: hash.toString(), height: header.number.toBigInt() };
            }),
          ),
          Effect.mapError(
            (error) =>
              new NodeClientError.ConnectionError({
                message: 'Failed to retrieve the finalized block',
                cause: error,
              }),
          ),
        ),
      () => this.#deregister(),
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
