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
import { Lifecycle } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import { Effect } from 'effect';
import * as rx from 'rxjs';
import { type WalletFacade } from '../../src/index.js';
import { type LifecycleTx } from '../../src/transaction.js';

/** The lifecycle records the facade keeps, one per transaction it balanced, finalized or submitted. */
export const lifecycleOf = (facade: WalletFacade): Effect.Effect<Lifecycle.TransactionLifecycle<LifecycleTx>> =>
  Effect.promise(() => rx.firstValueFrom(facade.transactionLifecycleService.state()));

/** The records that can still move, and so still say their coins are spoken for. */
export const liveRecordsOf = (
  facade: WalletFacade,
): Effect.Effect<ReadonlyArray<Lifecycle.LifecycleRecord<LifecycleTx>>> =>
  lifecycleOf(facade).pipe(Effect.map((lifecycle) => lifecycle.records.filter(Lifecycle.isLive)));
