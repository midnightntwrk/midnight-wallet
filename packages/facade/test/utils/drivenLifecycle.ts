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
import { type ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  Lifecycle,
  type TransactionLifecycleService,
} from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import { DateTime } from 'effect';
import * as rx from 'rxjs';
import { type LifecycleTx } from '../../src/transaction.js';

/**
 * A lifecycle service the test drives: every move the facade makes is applied with the real transitions, it never
 * polls, and the test pushes the verdicts itself, so the facade's reaction to a record's end is observable without an
 * indexer.
 */
export class DrivenLifecycle implements TransactionLifecycleService<LifecycleTx> {
  readonly states: rx.BehaviorSubject<Lifecycle.TransactionLifecycle<LifecycleTx>>;
  /** The identifiers of every transaction the facade recorded as reverted, in order. */
  readonly revertedIds: (readonly string[])[] = [];
  readonly orphanedBeyond: ProtocolVersion.ProtocolVersion[] = [];

  constructor(initial: Lifecycle.TransactionLifecycle<LifecycleTx> = Lifecycle.empty()) {
    this.states = new rx.BehaviorSubject(initial);
  }

  start(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  state(): rx.Observable<Lifecycle.TransactionLifecycle<LifecycleTx>> {
    return this.states.asObservable();
  }

  balanced(facts: Lifecycle.TransactionFacts<LifecycleTx>): Promise<void> {
    return this.#move((state) => Lifecycle.balanced(state, facts, DateTime.unsafeNow()));
  }

  finalized(facts: Lifecycle.TransactionFacts<LifecycleTx>): Promise<void> {
    return this.#move((state) => Lifecycle.finalized(state, facts, DateTime.unsafeNow()));
  }

  submitted(facts: Lifecycle.TransactionFacts<LifecycleTx>): Promise<void> {
    return this.#move((state) => Lifecycle.submitted(state, facts, DateTime.unsafeNow()));
  }

  reverted(identifiers: readonly string[]): Promise<void> {
    this.revertedIds.push(identifiers);
    return this.#move((state) => Lifecycle.reverted(state, identifiers));
  }

  orphanBeyond(chainNow: ProtocolVersion.ProtocolVersion): Promise<void> {
    this.orphanedBeyond.push(chainNow);
    return Promise.resolve();
  }

  /** Ends every live record as the chain's verdict says. */
  verdict(result: Lifecycle.RejectedVerdict | Readonly<{ status: 'SUCCESS' }>): void {
    this.#settleLive(() =>
      result.status === 'SUCCESS'
        ? Lifecycle.LifecycleState.Confirmed()
        : Lifecycle.LifecycleState.Rejected({ verdict: result }),
    );
  }

  /** Ends every live record as orphaned: built for `authoredFor`, while the chain has reached `chainNow`. */
  orphaned(authoredFor: ProtocolVersion.ProtocolVersion, chainNow: ProtocolVersion.ProtocolVersion): void {
    this.#settleLive(() => Lifecycle.LifecycleState.Orphaned({ authoredFor, chainNow }));
  }

  /** Publishes the current records again, unchanged, as every tick of the real service does. */
  republish(): void {
    this.states.next({ ...this.states.value });
  }

  #settleLive(to: () => Lifecycle.LifecycleState): void {
    const state = this.states.value;
    this.states.next({
      ...state,
      records: state.records.map((record) => (Lifecycle.isLive(record) ? { ...record, state: to() } : record)),
    });
  }

  #move(
    step: (state: Lifecycle.TransactionLifecycle<LifecycleTx>) => Lifecycle.TransactionLifecycle<LifecycleTx>,
  ): Promise<void> {
    this.states.next(step(this.states.value));
    return Promise.resolve();
  }
}
