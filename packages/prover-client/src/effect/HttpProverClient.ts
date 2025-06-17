import { Effect, Context, Layer, Stream, Chunk, Schedule, Duration } from 'effect';
import { HttpClientRequest, HttpClientResponse, HttpClient, FetchHttpClient } from '@effect/platform';
import { ProverClient, InvalidProtocolSchemeError, ProverClientError, ProverServerError } from './ProverClient';
import { SerializedUnprovenTransaction } from './SerializedUnprovenTransaction';
import { SerializedTransaction } from './SerializedTransaction';

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
          const proveTxRequest = HttpClientRequest.post(url).pipe(
            HttpClientRequest.bodyUint8Array(transaction),
            HttpClient.execute,
            HttpClientResponse.stream,
            Stream.runCollect,
            Effect.flatMap((chunks) => Effect.promise(() => new Blob(Chunk.toArray(chunks)).bytes())),
            Effect.retry({
              times: 3,
              while: (error) =>
                // Retry if we get a Bad Gateway, Service Unavailable, or Gateway Timeout error.
                error._tag === 'ResponseError' && error.response.status >= 502 && error.response.status <= 504,
              schedule: Schedule.exponential(Duration.seconds(2), 2),
            }),
          );

          return proveTxRequest.pipe(
            Effect.flatMap((a) => Effect.succeed(SerializedTransaction(a))),
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
