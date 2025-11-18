// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
  static readonly tag = 'InvalidProtocolSchemeError' as const;
}

export class FailedToDeriveWebSocketUrlError extends Data.TaggedError('FailedToDeriveWebSocketUrlError')<{
  /** A message describing the error. */
  readonly message: string;

  readonly cause?: unknown;
}> {
  static readonly tag = 'FailedToDeriveWebSocketUrlError' as const;
}

export type URLError = InvalidProtocolSchemeError | FailedToDeriveWebSocketUrlError;
