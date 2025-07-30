import { Data } from 'effect';

/**
 * A configuration error where the protocol scheme of a given server URL was unexpected (e.g., used
 * `'ftp:'` rather than `'http:'` for a server running over HTTP).
 */
export class InvalidProtocolSchemeError extends Data.TaggedError('InvalidProtocolSchemeError')<{
  /** A message describing the error. */
  readonly message: string;

  /** The scheme that caused the error. */
  readonly invalidScheme: string;
}> {
  static tag = 'InvalidProtocolSchemeError' as const;
}
