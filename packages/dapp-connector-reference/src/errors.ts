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

export const APIError = {
  internalError: (_reason: string): APIErrorType => {
    throw new Error('Not implemented');
  },

  rejected: (_reason: string): APIErrorType => {
    throw new Error('Not implemented');
  },

  invalidRequest: (_reason: string): APIErrorType => {
    throw new Error('Not implemented');
  },

  permissionRejected: (_reason: string): APIErrorType => {
    throw new Error('Not implemented');
  },

  disconnected: (_reason: string): APIErrorType => {
    throw new Error('Not implemented');
  },

  isAPIError: (_value: unknown): _value is APIErrorType => {
    throw new Error('Not implemented');
  },
};
