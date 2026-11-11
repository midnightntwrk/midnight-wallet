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
import { Chunk, type Context, Data, Duration, Effect, Either, Layer, pipe, Schedule, Stream } from 'effect';
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest, type HttpClientResponse } from '@effect/platform';
import { ProverClient } from './ProverClient.js';
import {
  ClientError,
  HttpURL,
  type InvalidProtocolSchemeError,
  ServerError,
} from '@midnightntwrk/wallet-sdk-utilities/networking';
import { BlobOps, EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import * as ledgerV8 from '@midnightntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';

const PROVE_TX_PATH = '/prove';
const CHECK_TX_PATH = '/check';

/**
 * How one ledger version frames a proof server request and reads its reply.
 *
 * @remarks
 *   The only thing that differs between the two ledger versions' providers, so it is the only thing named. A preimage is
 *   produced by one ledger version and has to be framed by that same one; that the two framings agree byte for byte on
 *   today's preimages is a coincidence of the current releases, not a property to build on.
 */
type PayloadFraming = Readonly<{
  createProvingPayload: (serializedPreimage: Uint8Array, overwriteBindingInput: bigint | undefined) => Uint8Array;
  createCheckPayload: (serializedPreimage: Uint8Array) => Uint8Array;
  parseCheckResult: (result: Uint8Array) => (bigint | undefined)[];
}>;

const v9Framing: PayloadFraming = {
  createProvingPayload: (preimage, binding) => ledgerV9.createProvingPayload(preimage, binding),
  createCheckPayload: (preimage) => ledgerV9.createCheckPayload(preimage),
  parseCheckResult: (result) => ledgerV9.parseCheckResult(result),
};

const v8Framing: PayloadFraming = {
  createProvingPayload: (preimage, binding) => ledgerV8.createProvingPayload(preimage, binding),
  createCheckPayload: (preimage) => ledgerV8.createCheckPayload(preimage),
  parseCheckResult: (result) => ledgerV8.parseCheckResult(result),
};

/**
 * How many requests a client has waiting at a proof server at once, unless its configuration says otherwise.
 *
 * @remarks
 *   The places a proof server has in its queue as released (`--job-capacity`). A job holds one from the moment it arrives
 *   until a worker takes it, and a request that finds them all taken is refused. The server's workers run beside the
 *   queue, but a job they have not got to yet still holds its place, so the queue is all the room a client that sends
 *   its requests at once can count on.
 */
const DEFAULT_MAX_CONCURRENT_REQUESTS = 10;

/**
 * How often, and how far apart, a request the proof server could not take is sent again, unless the client's
 * configuration says otherwise: after 1 second, then twice as long each time up to 10 seconds, for 5 minutes in all.
 *
 * @remarks
 *   A place in a proof server's queue frees each time a worker starts another proof. With the two workers it has as
 *   released, that ranges from a few times a second, on a fast machine making Dust spend proofs of about half a second
 *   each, to once in ten seconds, on a slow one making zswap proofs of about twenty. The first wait sits between the
 *   two, and the waits grow to the slow end, because a server still full after the short waits is one of the slow ones.
 *   Five minutes is time for a full server of the slowest of those proofs to empty twice over. The waits are jittered,
 *   so that requests refused together do not all come back together.
 */
const defaultRetrySchedule: Schedule.Schedule<unknown, unknown> = pipe(
  Schedule.exponential(Duration.seconds(1), 2),
  Schedule.union(Schedule.spaced(Duration.seconds(10))),
  Schedule.jittered,
  Schedule.upTo(Duration.minutes(5)),
);

/**
 * How many minutes a request may go without a reply before it is given up.
 *
 * @remarks
 *   A request holds one of its client's permits until its reply has been read, so one that is never answered would hold
 *   it for good, and enough of them would leave the client unable to send anything. This is as long as a proof server
 *   lets a job run as released (`--job-timeout`), so no proof it would have made is lost by giving up here.
 */
const REQUEST_TIMEOUT_MINUTES = 10;

/** A request the proof server had not answered when its time ran out. */
class Unanswered extends Data.TaggedError('Unanswered')<{
  readonly message: string;
}> {}

/**
 * A reply that was not a result: what the proof server, or something answering in its place, said and with which
 * status.
 */
class Refusal extends Data.TaggedError('Refusal')<{
  readonly status: number;
  readonly message: string;
}> {}

/**
 * Whether sending the same request again may get a different reply: the server's queue was full (429), or the reply
 * never came from the server at all but from something between the client and it giving way (502, 503, 504).
 */
const mayPass = (status: number): boolean => status === 429 || (status >= 502 && status <= 504);

/** Raised when a client is configured with a cap that is not a number of requests: a whole number, at least one. */
export class InvalidMaxConcurrentRequestsError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-prover-client/effect/HttpProverClient/InvalidMaxConcurrentRequestsError',
)<{
  readonly message: string;
  /** The cap that was configured. */
  readonly maxConcurrentRequests: number;
}> {}

/**
 * Reads a configured cap as the number of permits a client is given.
 *
 * @remarks
 *   Permits are taken one per request, so a cap that is not a whole number of at least one has no reading that sends a
 *   request: a client given none waits forever before its first. It is refused here rather than turned into a client
 *   that never proves anything.
 */
const parseMaxConcurrentRequests = (
  configured: number | undefined,
): Either.Either<number, InvalidMaxConcurrentRequestsError> =>
  configured === undefined
    ? Either.right(DEFAULT_MAX_CONCURRENT_REQUESTS)
    : Number.isInteger(configured) && configured >= 1
      ? Either.right(configured)
      : Either.left(
          new InvalidMaxConcurrentRequestsError({
            message: `maxConcurrentRequests must be a whole number of at least 1, but was ${configured}`,
            maxConcurrentRequests: configured,
          }),
        );

/**
 * Builds a client for one proof server, with the permits that bound what it has waiting there.
 *
 * @remarks
 *   The permits belong to the client rather than to a request or a provider, because what they stand for is room in one
 *   proof server's queue: every request this client makes, through whichever provider, waits in that same queue.
 */
const make = (
  config: ProverClient.ServerConfig,
): Effect.Effect<HttpProverClientImpl, InvalidProtocolSchemeError | InvalidMaxConcurrentRequestsError> =>
  pipe(
    Either.all({
      baseUrl: HttpURL.make(new URL(config.url)),
      permits: parseMaxConcurrentRequests(config.maxConcurrentRequests),
    }),
    EitherOps.toEffect,
    Effect.flatMap(({ baseUrl, permits }) =>
      Effect.map(
        Effect.makeSemaphore(permits),
        (requestPermits) =>
          new HttpProverClientImpl(baseUrl, requestPermits, config.retrySchedule ?? defaultRetrySchedule),
      ),
    ),
  );

/**
 * Creates a layer for a {@link ProverClient} that sends requests to a Proof Server over HTTP.
 *
 * @param config The server configuration to use when configuring the HTTP elements of the layer.
 * @returns A `Layer` for {@link ProverClient} that sends requests to a configured Proof Server over HTTP. The layer can
 *   fail with an `InvalidProtocolSchemeError` if `config` is invalid for a HTTP context, or with an
 *   {@link InvalidMaxConcurrentRequestsError} if its `maxConcurrentRequests` is not a whole number of at least one.
 */
export const layer: (
  config: ProverClient.ServerConfig,
) => Layer.Layer<ProverClient, InvalidProtocolSchemeError | InvalidMaxConcurrentRequestsError> = (config) =>
  Layer.effect(ProverClient, make(config));

/**
 * Creates a {@link ProverClient} that sends requests to a Proof Server over HTTP.
 *
 * @example
 *   ```typescript
 *   const client = yield* HttpProverClient.create({ url: 'http://localhost:6300', maxConcurrentRequests: 4 });
 *   const proven = yield* client.proveTransaction(unprovenTransaction, ledger.CostModel.initialCostModel());
 *   ```;
 *
 * @param config The Proof Server to send requests to, and how many of them to have waiting there at once.
 * @returns An `Effect` that yields the client; or fails with an `InvalidProtocolSchemeError` if `config` is invalid for
 *   a HTTP context, or with an {@link InvalidMaxConcurrentRequestsError} if its `maxConcurrentRequests` is not a whole
 *   number of at least one.
 */
export const create = (
  config: ProverClient.ServerConfig,
): Effect.Effect<ProverClient.Service, InvalidProtocolSchemeError | InvalidMaxConcurrentRequestsError> =>
  pipe(
    make(config),
    Effect.map((client) => ProverClient.of(client)),
  );

class HttpProverClientImpl implements Context.Tag.Service<ProverClient> {
  constructor(
    baseUrl: HttpURL.HttpUrl,
    requestPermits: Effect.Semaphore,
    retrySchedule: Schedule.Schedule<unknown, unknown>,
  ) {
    this.baseUrl = baseUrl;
    this.requestPermits = requestPermits;
    this.retrySchedule = retrySchedule;
  }

  protected readonly baseUrl: HttpURL.HttpUrl;

  /** One per request this client may have waiting at the proof server at once. */
  private readonly requestPermits: Effect.Semaphore;

  /** How often, and how far apart, a request the proof server could not take is sent again. */
  private readonly retrySchedule: Schedule.Schedule<unknown, unknown>;

  private request(
    path: string,
    payload: Uint8Array,
    failurePrefix: string,
  ): Effect.Effect<Uint8Array, ClientError | ServerError> {
    const concatBytes = (chunks: Uint8Array[]): Effect.Effect<Uint8Array> =>
      Effect.promise((): Promise<Uint8Array> =>
        BlobOps.getBytes(new Blob(chunks.map((chunk) => new Uint8Array(chunk)))),
      );

    const receiveBody = (response: HttpClientResponse.HttpClientResponse) =>
      pipe(
        response.stream,
        Stream.runCollect,
        Effect.flatMap((chunks) => concatBytes(Chunk.toArray(chunks))),
      );

    // Build endpoint URL from the already validated base URL
    const url = HttpURL.HttpURL(new URL(path, this.baseUrl));

    const proveTxRequest = pipe(
      Effect.succeed(payload),
      Effect.map((body) =>
        HttpClientRequest.post(url).pipe(
          // A raw body must be used instead of `bodyUint8Array` so that no explicit `content-length`
          // header is attached: `fetch` derives the length from the body itself, and an explicit
          // header is rejected as malformed by undici >= 8.2.0 when it is installed as the global
          // dispatcher (e.g. transitively via testcontainers or @effect/platform-node).
          HttpClientRequest.setBody(HttpBody.raw(body, { contentType: 'application/octet-stream' })),
        ),
      ),
      Effect.flatMap(HttpClient.execute),
      Effect.flatMap((response: HttpClientResponse.HttpClientResponse) =>
        Effect.gen(function* () {
          if (response.status !== 200) {
            const text = yield* response.text;
            return yield* new Refusal({ status: response.status, message: `${failurePrefix}: ${text}` });
          }
          return yield* receiveBody(response);
        }),
      ),
      // Given up inside its permit, so that giving up is what frees the place. It is not sent again: a request still
      // waiting after this long may be a proof still being made, and sending it again would have it made twice.
      Effect.timeoutFail({
        duration: Duration.minutes(REQUEST_TIMEOUT_MINUTES),
        onTimeout: () =>
          new Unanswered({
            message: `${failurePrefix}: the Proof Server did not answer within ${REQUEST_TIMEOUT_MINUTES} minutes`,
          }),
      }),
      // Held from the moment a request is sent until its reply has been read, so that no more requests than there
      // are permits wait at the proof server at once. Taken per attempt: a request waiting to be tried again has
      // nothing at the server, and holds no place another could use.
      this.requestPermits.withPermits(1),
      Effect.retry({
        schedule: this.retrySchedule,
        // A reply can break off before its body is read, and then there is no refusal to speak of, only a response
        // that could not be read. Its status still says whether sending again may get a different one.
        while: (error) =>
          (error._tag === 'Refusal' && mayPass(error.status)) ||
          (error._tag === 'ResponseError' && mayPass(error.response.status)),
      }),
    );

    return proveTxRequest.pipe(
      Effect.catchTags({
        Refusal: (refusal) => new ClientError({ message: refusal.message }),
        Unanswered: (unanswered) => new ClientError({ message: unanswered.message }),
        RequestError: (err) => new ClientError({ message: `Failed to connect to Proof Server: ${err.message}` }),
        ResponseError: (err) =>
          Effect.orElseSucceed(err.response.text, () => 'Unknown server error').pipe(
            Effect.flatMap((message) => new ServerError({ message })),
          ),
      }),
      Effect.provide(FetchHttpClient.layer),
    );
  }

  // Each request is run to its end on its own. The ledger asks through a promise, for every proof of a transaction up
  // front, and has no way to say it has stopped waiting; and a proof server makes every proof it has accepted whether
  // or not anyone still wants it. So interrupting whoever asked for the transaction's proof stops none of these.
  private serverProverProvider = (framing: PayloadFraming): ledgerV9.ProvingProvider => ({
    check: async (serializedPreimage: Uint8Array, _keyLocation: string): Promise<(bigint | undefined)[]> =>
      pipe(
        Effect.succeed(framing.createCheckPayload(serializedPreimage)),
        Effect.flatMap((tx) => this.request(CHECK_TX_PATH, tx, 'Failed to check')),
        Effect.map((response) => framing.parseCheckResult(response)),
        Effect.runPromise,
      ),
    prove: async (
      serializedPreimage: Uint8Array,
      _keyLocation: string,
      overwriteBindingInput?: bigint,
    ): Promise<Uint8Array> =>
      pipe(
        Effect.succeed(framing.createProvingPayload(serializedPreimage, overwriteBindingInput)),
        Effect.flatMap((tx) => this.request(PROVE_TX_PATH, tx, 'Failed to prove')),
        Effect.runPromise,
      ),
    // The proof server holds its own key material and resolves circuits from the
    // preimage's key location, so there is never local key material to provide.
    lookupKey: (_keyLocation: string): Promise<ledgerV9.ProvingKeyMaterial | undefined> => Promise.resolve(undefined),
  });

  proveTransaction<S extends ledgerV9.Signaturish, B extends ledgerV9.Bindingish>(
    transaction: ledgerV9.Transaction<S, ledgerV9.PreProof, B>,
    costModel: ledgerV9.CostModel,
  ): Effect.Effect<ledgerV9.Transaction<S, ledgerV9.Proof, B>, ClientError | ServerError> {
    return pipe(
      Effect.succeed(this.serverProverProvider(v9Framing)),
      Effect.flatMap((provider) =>
        Effect.tryPromise({
          try: () => transaction.prove(provider, costModel),
          catch: (error) =>
            error instanceof ClientError || error instanceof ServerError
              ? error
              : new ClientError({ message: 'Failed to prove transaction', cause: error }),
        }),
      ),
    );
  }

  asProvingProvider(): ledgerV9.ProvingProvider {
    return this.serverProverProvider(v9Framing);
  }

  asV9ProvingProvider(): ledgerV9.ProvingProvider {
    return this.asProvingProvider();
  }

  asV8ProvingProvider(): ledgerV8.ProvingProvider {
    return this.serverProverProvider(v8Framing);
  }
}
