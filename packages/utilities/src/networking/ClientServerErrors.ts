import { Data } from 'effect';

/**
 * An error representing a connection or client-side error.
 *
 * @remarks
 * This error typically indicates a connection issue with a target server, or when the client has submitted some
 * data that could not be processed.
 */
export class ClientError extends Data.TaggedError('ClientError')<{
  readonly message: string;

  readonly cause?: unknown;
}> {}

/**
 * An error representing a server-side error.
 */
export class ServerError extends Data.TaggedError('ServerError')<{
  readonly message: string;
}> {}
