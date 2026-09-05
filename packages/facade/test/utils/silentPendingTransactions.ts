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

import { type FinalizedTx, type ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import type { PendingTransactionsService } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import { type Option } from 'effect';
import * as rx from 'rxjs';

/**
 * A pending service that answers and records nothing, so the facade's own orphaning subscription has somewhere to go.
 *
 * @remarks
 *   Carries the service's full signatures so that a suite which needs one method to record can extend it and override
 *   that method alone.
 */
export class SilentPendingTransactions implements PendingTransactionsService<FinalizedTx> {
  readonly states = new rx.BehaviorSubject<PendingTransactions.PendingTransactions<FinalizedTx>>(
    PendingTransactions.empty(),
  );

  start(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  state(): rx.Observable<PendingTransactions.PendingTransactions<FinalizedTx>> {
    return this.states.asObservable();
  }

  addPendingTransaction(
    _tx: FinalizedTx,
    _protocolVersion: Option.Option<ProtocolVersion.ProtocolVersion>,
  ): Promise<void> {
    return Promise.resolve();
  }

  clear(_tx: FinalizedTx): Promise<void> {
    return Promise.resolve();
  }

  orphanBeyond(_chainNow: ProtocolVersion.ProtocolVersion): Promise<void> {
    return Promise.resolve();
  }
}
