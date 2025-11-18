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
import { Either, Data } from 'effect';

export class LedgerError extends Data.TaggedError('LedgerError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const ledgerTry = <A>(fn: () => A): Either.Either<A, LedgerError> => {
  return Either.try({
    try: fn,
    catch: (error) => {
      const message = error instanceof Error ? error.message : `${error?.toString()}`;
      return new LedgerError({ message: `Error from ledger: ${message}`, cause: error });
    },
  });
};

export const generateHex = (len: number): string => {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(len / 2))).toString('hex');
};

export const randomNonce = (): string => generateHex(64);
