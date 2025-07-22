import { Either } from 'effect';
import * as Brand from 'effect/Brand';
import { InvalidProtocolSchemeError } from './InvalidProtocolSchemeError';

/**
 * A 'HTTP' URL.
 */
export type HttpUrl = Brand.Branded<URL, 'HttpURL'>;
/**
 * Constructs a 'HTTP' URL from a source URL, ensuring that the protocol is correct.
 */
export const HttpURL = Brand.refined<HttpUrl>(
  (url) => url.protocol === 'http:' || url.protocol === 'https:',
  (url) => Brand.error(`Invalid protocol scheme '${url.protocol}'. Expected 'http:' or 'https:'`),
);

/**
 * Constructs a new {@link HttpURL} from a given string.
 *
 * @param url The URL to be made into a HTTP URL.
 * @returns An `Either` that represents the valid HTTP URL constructed from `url`; or an
 * {@link InvalidProtocolSchemeError}.
 */
export const make: (url: URL | string) => Either.Either<HttpUrl, InvalidProtocolSchemeError> = (url) => {
  const targetURL = new URL(url);
  try {
    return Either.right(HttpURL(targetURL));
  } catch (err: unknown) {
    return Either.left(new InvalidProtocolSchemeError({ message: String(err), invalidScheme: targetURL.protocol }));
  }
};
