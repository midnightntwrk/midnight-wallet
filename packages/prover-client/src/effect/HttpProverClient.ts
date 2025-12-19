// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import { Chunk, Context, Duration, Effect, Either, Layer, pipe, Schedule, Stream } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from '@effect/platform';
import { SerializedTransaction, SerializedUnprovenTransaction } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { ProverClient } from './ProverClient.js';
import {
  InvalidProtocolSchemeError,
  ClientError,
  ServerError,
  HttpURL,
} from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { BlobOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import * as ledger from '@midnight-ntwrk/ledger-v6';

const PROVE_TX_PATH = '/prove';
const CHECK_TX_PATH = '/check';

/**
 * Creates a layer for a {@link ProverClient} that sends requests to a Proof Server over HTTP.
 *
 * @param config The server configuration to use when configuring the HTTP elements of the layer.
 * @returns A `Layer` for {@link ProverClient} that sends requests to a configured Proof Server over HTTP.
 * The layer can fail with an `InvalidProtocolSchemeError` if `config` is invalid for a HTTP context.
 */
export const layer: (config: ProverClient.ServerConfig) => Layer.Layer<ProverClient, InvalidProtocolSchemeError> = (
  config,
) =>
  Layer.effect(
    ProverClient,
    HttpURL.make(new URL(config.url)).pipe(
      Either.map((baseUrl) => new HttpProverClientImpl(baseUrl)),
      Either.match({
        onLeft: (l) => Effect.fail(l),
        onRight: (r) => Effect.succeed(r),
      }),
    ),
  );

class HttpProverClientImpl implements Context.Tag.Service<ProverClient> {
  constructor(baseUrl: HttpURL.HttpUrl) {
    this.baseUrl = baseUrl;
  }

  protected readonly baseUrl: HttpURL.HttpUrl;

  private request(
    path: string,
    transaction: SerializedUnprovenTransaction | SerializedTransaction,
    failurePrefix: string,
  ): Effect.Effect<SerializedTransaction, ClientError | ServerError> {
    const concatBytes = (chunks: Uint8Array[]): Effect.Effect<Uint8Array> =>
      Effect.promise((): Promise<Uint8Array> => BlobOps.getBytes(new Blob(chunks)));

    const receiveBody = (response: HttpClientResponse.HttpClientResponse) =>
      pipe(
        response.stream,
        Stream.runCollect,
        Effect.flatMap((chunks) => concatBytes(Chunk.toArray(chunks))),
      );

    // Build endpoint URL from the already validated base URL
    const url = HttpURL.HttpURL(new URL(path, this.baseUrl));

    const proveTxRequest = pipe(
      Effect.succeed(transaction),
      Effect.map((body) => HttpClientRequest.post(url).pipe(HttpClientRequest.bodyUint8Array(body))),
      Effect.flatMap(HttpClient.execute),
      Effect.flatMap((response: HttpClientResponse.HttpClientResponse) =>
        Effect.gen(function* () {
          if (response.status !== 200) {
            const text = yield* response.text;
            return yield* new ClientError({ message: `${failurePrefix}: ${text}` });
          }
          return yield* receiveBody(response);
        }),
      ),
      Effect.retry({
        times: 3,
        while: (error) =>
          // Retry if we get a Bad Gateway, Service Unavailable, or Gateway Timeout error.
          error._tag === 'ResponseError' && error.response.status >= 502 && error.response.status <= 504,
        schedule: Schedule.exponential(Duration.seconds(2), 2),
      }),
    );

    return proveTxRequest.pipe(
      Effect.map(SerializedTransaction),
      Effect.catchTags({
        RequestError: (err) => new ClientError({ message: `Failed to connect to Proof Server: ${err.message}` }),
        ResponseError: (err) =>
          Effect.orElseSucceed(err.response.text, () => 'Unknown server error').pipe(
            Effect.flatMap((message) => new ServerError({ message })),
          ),
      }),
      Effect.provide(FetchHttpClient.layer),
    );
  }

  private serverProverProvider = (): ledger.ProvingProvider => ({
    check: async (serializedPreimage: Uint8Array, _keyLocation: string): Promise<(bigint | undefined)[]> =>
      pipe(
        Effect.succeed(ledger.createCheckPayload(serializedPreimage)),
        Effect.map(SerializedTransaction),
        Effect.flatMap((tx) => this.request(CHECK_TX_PATH, tx, 'Failed to check')),
        Effect.map((response) => ledger.parseCheckResult(response)),
        Effect.runPromise,
      ),
    prove: async (
      serializedPreimage: Uint8Array,
      _keyLocation: string,
      overwriteBindingInput?: bigint,
    ): Promise<Uint8Array> =>
      pipe(
        Effect.succeed(ledger.createProvingPayload(serializedPreimage, overwriteBindingInput)),
        Effect.map(SerializedUnprovenTransaction),
        Effect.flatMap((tx) => this.request(PROVE_TX_PATH, tx, 'Failed to prove')),
        Effect.runPromise,
      ),
  });

  proveTransaction<S extends ledger.Signaturish, B extends ledger.Bindingish>(
    transaction: ledger.Transaction<S, ledger.PreProof, B>,
    costModel: ledger.CostModel,
  ): Effect.Effect<ledger.Transaction<S, ledger.Proof, B>, ClientError | ServerError> {
    return pipe(
      Effect.succeed(this.serverProverProvider()),
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
}
