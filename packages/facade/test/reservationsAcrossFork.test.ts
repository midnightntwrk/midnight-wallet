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

/**
 * Reservations taken while the chain is still below `forks.v9`.
 *
 * @remarks
 *   A reservation names the coins balancing booked, and the facade reads those coins off the transaction the unshielded
 *   wallet built. Below the boundary that transaction is a ledger-v8 one, built by the V1 variant, and this wallet's
 *   key has ledger-v8's bare shape, so the facade has to read it as ledger-v8 bytes. Every other reservation suite runs
 *   a chain that is on ledger-v9 from its first block, so this is the only place the ledger-v8 reading is exercised.
 *
 *   The facade is `forkingFacadeAt`'s: the shipped forking unshielded wallet syncing a ledger-v8 chain that never reaches
 *   the boundary, with the shielded and dust wallets driven at the chain's version. A transfer of Night that pays no
 *   fee needs nothing from those two but the version they report.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import { type FinalizedTx, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import { Effect } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { type FacadeState, type WalletFacade } from '../src/index.js';
import { forkingFacadeAt, forkingFacadeSchedule, tokenValue } from './utils/index.js';

vi.setConfig({ testTimeout: 30_000 });

const SEED = '0000000000000000000000000000000000000000000000000000000000000005';

/** The boundary, deliberately above every version the ledger-v8 chain here reaches. */
const forkVersion = forkingFacadeSchedule.v9;

/** The version the ledger-v8 chain runs at, and so the one every wallet reports. */
const v8Version = ProtocolVersion.MinSupportedVersion;

const V8_NIGHT = ledgerV8.nativeToken().raw;

const utxoKey = (coin: { utxo: { intentHash: string; outputNo: number } }): string =>
  `${coin.utxo.intentHash}#${coin.utxo.outputNo}`;

/** The pending set as the facade's pending-transactions service holds it, which is where reservations live. */
const pendingSet = (facade: WalletFacade): Effect.Effect<PendingTransactions.PendingTransactions<FinalizedTx>> =>
  Effect.promise(() => rx.firstValueFrom(facade.pendingTransactionsService.state()));

/** A fork-aware facade over a ledger-v8 chain that has paid this wallet Night, with the unshielded wallet syncing it. */
const facadeBelowTheFork = () => forkingFacadeAt({ seed: SEED, chainVersion: v8Version });

describe('A reservation taken below forks.v9', () => {
  it('names exactly the coins the V1 wallet booked for the transfer', () =>
    Effect.gen(function* () {
      const facade = yield* facadeBelowTheFork();
      const address = yield* Effect.promise(() => facade.unshielded.getAddress());

      const recipe = yield* Effect.promise(() =>
        facade.transferTransaction(
          [{ type: 'unshielded', outputs: [{ type: V8_NIGHT, receiverAddress: address, amount: tokenValue(1n) }] }],
          { ttl: new Date(Date.now() + 60 * 60 * 1000), payFees: false },
        ),
      );

      // The transfer was built on ledger-v8, which is the reading under test.
      expect(recipe.transaction.protocolVersion).toBeLessThan(forkVersion);

      // The wallet publishes its booking on its own fiber, so wait for it rather than read the state straight away.
      const after: FacadeState = yield* Effect.promise(() =>
        rx.firstValueFrom(facade.state().pipe(rx.filter((state) => state.unshielded.pendingCoins.length > 0))),
      );
      const booked = after.unshielded.pendingCoins.map(utxoKey).toSorted();

      const pending = yield* pendingSet(facade);
      expect(pending.reservations).toHaveLength(1);
      expect(pending.reservations[0].inputs.unshielded.toSorted()).toEqual(booked);
    }).pipe(Effect.scoped, Effect.runPromise));
});
