import type { APIError as APIErrorType, ErrorCode } from '@midnight-ntwrk/dapp-connector-api';
import { ErrorCodes as APIErrorCodes } from '@midnight-ntwrk/dapp-connector-api';

/**
 * Re-export error codes from the DApp Connector API specification.
 */
export const ErrorCodes = APIErrorCodes;

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

  /**
   * Creates an InsufficientFunds error for when wallet lacks balance to complete a transaction.
   * @param reason - Description of what funds are insufficient (e.g., "Insufficient shielded balance for token X")
   */
  insufficientFunds: (reason: string): APIErrorType => new APIErrorImpl('InsufficientFunds', reason),

  isAPIError: (value: unknown): value is APIErrorType => value instanceof APIErrorImpl,
};
