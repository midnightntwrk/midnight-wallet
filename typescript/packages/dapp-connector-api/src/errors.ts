/**
 * The following error codes can be thrown by the dapp connector.
 */
export const ErrorCodes = {
  /** The dapp connector wasn't able to process the request */
  InternalError: 'InternalError',
  /** The user rejected the request */
  Rejected: 'Rejected',
  /** Can be thrown in various circumstances, e.g. one being a malformed transaction */
  InvalidRequest: 'InvalidRequest',
} as const;

/**
 * ErrorCode type definition
 */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Whenever there's a function called that returns a promise,
 * an error with the shape can be thrown.
 */
export interface APIError {
  /** The code of the error that's thrown */
  code: ErrorCode;
  /** The reason the error is thrown */
  reason: string;
}
