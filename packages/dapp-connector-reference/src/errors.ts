// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import type { APIError as APIErrorType, ErrorCode } from '@midnightntwrk/dapp-connector-api';
import { ErrorCodes as APIErrorCodes } from '@midnightntwrk/dapp-connector-api';

/** Re-export error codes from the DApp Connector API specification. */
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
   *
   * @param reason - Description of what funds are insufficient (e.g., "Insufficient shielded balance for token X")
   */
  insufficientFunds: (reason: string): APIErrorType => new APIErrorImpl('InsufficientFunds', reason),

  isAPIError: (value: unknown): value is APIErrorType => value instanceof APIErrorImpl,
};
