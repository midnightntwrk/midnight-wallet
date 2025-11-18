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
import { SubmissionEvent } from './SubmissionEvent.js';

export class SubmissionError extends Data.TaggedError('SubmissionError')<{
  message: string;
  txData: Uint8Array;
  cause?: unknown;
}> {}
export class ConnectionError extends Data.TaggedError('ConnectionError')<{
  message: string;
  cause?: unknown;
}> {}
export class TransactionProgressError extends Data.TaggedError('TransactionProgressError')<{
  message: string;
  txData: Uint8Array;
  desiredStage: SubmissionEvent['_tag'];
}> {}
export class ParseError extends Data.TaggedError('ParseError')<{
  message: string;
  cause?: unknown;
}> {}
export class TransactionUsurpedError extends Data.TaggedError('TransactionUsurpedError')<{
  message: string;
  txData: Uint8Array;
}> {}
export class TransactionDroppedError extends Data.TaggedError('TransactionDroppedError')<{
  message: string;
  txData: Uint8Array;
}> {}
export class TransactionInvalidError extends Data.TaggedError('TransactionInvalidError')<{
  message: string;
  txData: Uint8Array;
  cause?: unknown;
}> {}

export type NodeClientError =
  | SubmissionError
  | ConnectionError
  | TransactionProgressError
  | ParseError
  | TransactionUsurpedError
  | TransactionDroppedError
  | TransactionInvalidError;
