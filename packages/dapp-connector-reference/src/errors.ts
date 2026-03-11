import type { APIError as APIErrorType, ErrorCode } from '@midnight-ntwrk/dapp-connector-api';

/**
 * All possible error codes for the DApp Connector API.
 * These match the values defined in @midnight-ntwrk/dapp-connector-api.
 */
export const ErrorCodes = {
  InternalError: 'InternalError',
  Rejected: 'Rejected',
  InvalidRequest: 'InvalidRequest',
  PermissionRejected: 'PermissionRejected',
  Disconnected: 'Disconnected',
} as const satisfies Record<string, ErrorCode>;

class APIErrorImpl extends Error implements APIErrorType {
  readonly type = 'DAppConnectorAPIError' as const;
  readonly code: ErrorCode;
  readonly reason: string;

  constructor(code: ErrorCode, reason: string) {
    super(reason);
    this.name = 'DAppConnectorAPIError';
    this.code = code;
    this.reason = reason;
  }
}

export const APIError = {
  internalError: (reason: string): APIErrorType => new APIErrorImpl('InternalError', reason),

  rejected: (reason: string): APIErrorType => new APIErrorImpl('Rejected', reason),

  invalidRequest: (reason: string): APIErrorType => new APIErrorImpl('InvalidRequest', reason),

  permissionRejected: (reason: string): APIErrorType => new APIErrorImpl('PermissionRejected', reason),

  disconnected: (reason: string): APIErrorType => new APIErrorImpl('Disconnected', reason),

  isAPIError: (value: unknown): value is APIErrorType => value instanceof APIErrorImpl,
};
