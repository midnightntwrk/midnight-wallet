/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { type ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type QueryClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { Effect, type ParseResult, type Scope, Stream } from 'effect';
import * as Lifecycle from './lifecycle.js';
import { type VersionedTransactionTrait } from './pendingTransactions.js';

/** Holds one lifecycle record per transaction and moves it as the facade and the chain report events. */
export type TransactionLifecycleServiceEffect<TTransaction> = {
  startPolling: (ticks: Stream.Stream<unknown>) => Effect.Effect<void, Error, QueryClient | Scope.Scope>;
  state: () => Stream.Stream<Lifecycle.TransactionLifecycle<TTransaction>>;
  balanced: (facts: Lifecycle.TransactionFacts<TTransaction>) => Effect.Effect<void>;
  finalized: (facts: Lifecycle.TransactionFacts<TTransaction>) => Effect.Effect<void>;
  submitted: (facts: Lifecycle.TransactionFacts<TTransaction>) => Effect.Effect<void>;
  reverted: (identifiers: readonly string[]) => Effect.Effect<void>;
  orphanBeyond: (chainNow: ProtocolVersion.ProtocolVersion) => Effect.Effect<void>;
};

export class TransactionLifecycleServiceEffectImpl<
  TTransaction,
> implements TransactionLifecycleServiceEffect<TTransaction> {
  static restore<TTransaction>(
    _data: string,
    txTraits: VersionedTransactionTrait<TTransaction>,
  ): Effect.Effect<TransactionLifecycleServiceEffectImpl<TTransaction>, ParseResult.ParseError> {
    return Effect.succeed(new TransactionLifecycleServiceEffectImpl<TTransaction>(txTraits));
  }

  constructor(
    _txTraits: VersionedTransactionTrait<TTransaction>,
    _initialState?: Lifecycle.TransactionLifecycle<TTransaction>,
  ) {}

  state(): Stream.Stream<Lifecycle.TransactionLifecycle<TTransaction>> {
    return Stream.make(Lifecycle.empty<TTransaction>());
  }

  startPolling(_ticks: Stream.Stream<unknown>): Effect.Effect<void, Error, QueryClient | Scope.Scope> {
    return Effect.void;
  }

  balanced(_facts: Lifecycle.TransactionFacts<TTransaction>): Effect.Effect<void> {
    return Effect.void;
  }

  finalized(_facts: Lifecycle.TransactionFacts<TTransaction>): Effect.Effect<void> {
    return Effect.void;
  }

  submitted(_facts: Lifecycle.TransactionFacts<TTransaction>): Effect.Effect<void> {
    return Effect.void;
  }

  reverted(_identifiers: readonly string[]): Effect.Effect<void> {
    return Effect.void;
  }

  orphanBeyond(_chainNow: ProtocolVersion.ProtocolVersion): Effect.Effect<void> {
    return Effect.void;
  }
}
