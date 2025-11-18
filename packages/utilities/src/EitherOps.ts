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
import { Effect, Either, Data } from 'effect';
import { dual } from 'effect/Function';

export const toEffect = <L, R>(either: Either.Either<R, L>): Effect.Effect<R, L> => {
  return Either.match(either, {
    onLeft: (l) => Effect.fail(l),
    onRight: (r) => Effect.succeed(r),
  });
};

export const flatMapLeft: {
  <R, L, L2>(either: Either.Either<R, L>, cb: (l: L) => Either.Either<R, L2>): Either.Either<R, L2>;
  <R, L, L2>(cb: (l: L) => Either.Either<R, L2>): (either: Either.Either<R, L>) => Either.Either<R, L2>;
} = dual(2, <R, L, L2>(either: Either.Either<R, L>, cb: (l: L) => Either.Either<R, L2>) => {
  return Either.match(either, {
    onRight: (r) => Either.right(r),
    onLeft: cb,
  });
});

export class LeftError<L> extends Data.TaggedError('LeftError')<{ message: string; cause: L }> {
  constructor({ cause }: { cause: L }) {
    super({ message: 'Unexpected left value', cause });
  }
}

export const getOrThrowLeft = <L, R>(either: Either.Either<R, L>): R => {
  return Either.match(either, {
    onRight: (r) => r,
    onLeft: (l) => {
      throw new LeftError({ cause: l });
    },
  });
};
