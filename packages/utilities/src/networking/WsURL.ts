import { Either } from 'effect';
import * as Brand from 'effect/Brand';
import { InvalidProtocolSchemeError } from './URLError.js';

/**
 * A 'HTTP' URL.
 */
export type WsURL = Brand.Branded<URL, 'WsURL'>;
/**
 * Constructs a 'WS' URL from a source URL, ensuring that the protocol is correct.
 */
export const WsURL = Brand.refined<WsURL>(
  (url) => url.protocol === 'ws:' || url.protocol === 'wss:',
  (url) => Brand.error(`Invalid protocol scheme '${url.protocol}'. Expected 'ws:' or 'wss:'`),
);

/**
 * Constructs a new {@link WsURL} from a given string.
 *
 * @param url The URL to be made into a WebSocket URL.
 * @returns An `Either` that represents the valid WebSocket URL constructed from `url`; or an
 * {@link InvalidProtocolSchemeError}.
 */
export const make: (url: URL | string) => Either.Either<WsURL, InvalidProtocolSchemeError> = (url) => {
  const targetURL = new URL(url);
  try {
    return Either.right(WsURL(targetURL));
  } catch (err: unknown) {
    return Either.left(new InvalidProtocolSchemeError({ message: String(err), invalidScheme: targetURL.protocol }));
  }
};
