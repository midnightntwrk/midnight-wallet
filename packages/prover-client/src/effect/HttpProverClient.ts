import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from '@effect/platform';
import { Chunk, Context, Duration, Effect, Layer, pipe, Schedule, Stream } from 'effect';
import { InvalidProtocolSchemeError, ProverClient, ProverClientError, ProverServerError } from './ProverClient';
import { SerializedTransaction } from './SerializedTransaction';
import { SerializedUnprovenTransaction } from './SerializedUnprovenTransaction';

const PROVE_TX_PATH = '/prove-tx';

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
    Effect.gen(function* () {
      const url = new URL(PROVE_TX_PATH, config.url);

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return yield* new InvalidProtocolSchemeError({
          invalidScheme: url.protocol,
          allowedSchemes: ['http:', 'https:'],
        });
      }

      return new (class HttpProverClient implements Context.Tag.Service<ProverClient> {
        proveTransaction(
          transaction: SerializedUnprovenTransaction,
        ): Effect.Effect<SerializedTransaction, ProverClientError | ProverServerError> {
          const concatBytes = (chunks: Uint8Array[]): Effect.Effect<Uint8Array> =>
            Effect.promise(() => new Blob(chunks).bytes());

          const receiveBody = (response: HttpClientResponse.HttpClientResponse) =>
            pipe(
              response.stream,
              Stream.runCollect,
              Effect.flatMap((chunks) => concatBytes(Chunk.toArray(chunks))),
            );

          const proveTxRequest = pipe(
            //The 4 empty bytes is an encoding of additional parameters proof server expects, in this case - empty
            concatBytes([transaction, new Uint8Array([0, 0, 0, 0])]),
            Effect.map((requestBody) =>
              HttpClientRequest.post(url).pipe(HttpClientRequest.bodyUint8Array(requestBody)),
            ),
            Effect.flatMap(HttpClient.execute),
            Effect.flatMap((response: HttpClientResponse.HttpClientResponse) => {
              return Effect.gen(function* () {
                // Simplistic, but so is the proof server
                if (response.status !== 200) {
                  const text = yield* response.text;
                  return yield* new ProverClientError({ message: `Failed to prove: ${text}` });
                }

                return yield* receiveBody(response);
              });
            }),
            Effect.retry({
              times: 3,
              while: (error) =>
                // Retry if we get a Bad Gateway, Service Unavailable, or Gateway Timeout error.
                error._tag === 'ResponseError' && error.response.status >= 502 && error.response.status <= 504,
              schedule: Schedule.exponential(Duration.seconds(2), 2),
            }),
          );

          return proveTxRequest.pipe(
            Effect.map((a) => SerializedTransaction(a)),
            Effect.catchTags({
              RequestError: (err) =>
                new ProverClientError({ message: `Failed to connect to Proof Server: ${err.message}` }),
              ResponseError: (err) =>
                Effect.orElseSucceed(err.response.text, () => 'Unknown server error').pipe(
                  Effect.flatMap((message) => new ProverServerError({ message })),
                ),
            }),
            Effect.provide(FetchHttpClient.layer),
          );
        }
      })();
    }),
  );
