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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { Simulator, immediateBlockProducer } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { type WalletFacade, WellFormedError } from '../src/index.js';
import {
  createSimulatorProvingService,
  createSimulatorWalletFactories,
  deriveWalletKeys,
  makeSimulatorFacade,
  type SimulatorConfig,
} from './utils/index.js';

const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const SEED = '0000000000000000000000000000000000000000000000000000000000000001';

// A finalized transaction with a TTL in the past fails the non-configurable TTL structural check.
const expiredFinalizedTx = (): ledger.FinalizedTransaction =>
  ledger.Transaction.fromParts(NETWORK_ID, undefined, undefined, ledger.Intent.new(new Date(0))).mockProve();

// Transactions built for a different network violate the non-configurable network-ID structural check.
// The facade is initialised with NETWORK_ID ('undeployed'); these transactions use 'mainnet'.
const wrongNetworkUnprovenTx = (): ledger.UnprovenTransaction =>
  ledger.Transaction.fromParts(NetworkId.NetworkId.MainNet);

const wrongNetworkFinalizedTx = (): ledger.FinalizedTransaction =>
  ledger.Transaction.fromParts(NetworkId.NetworkId.MainNet).mockProve();

const setupFacade = (): Effect.Effect<
  WalletFacade,
  never,
  Effect.Effect.Context<ReturnType<typeof makeSimulatorFacade>>
> =>
  Effect.gen(function* () {
    const keys = deriveWalletKeys(SEED, NETWORK_ID);
    const simulator = yield* Simulator.init({ blockProducer: immediateBlockProducer() });
    const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
    const factories = createSimulatorWalletFactories(config);
    return yield* makeSimulatorFacade(config, keys, factories);
  });

const FULL_STRICTNESS = { enforceBalancing: true, verifySignatures: true, enforceLimits: true } as const;

describe('WalletFacade.validateTransaction', () => {
  it('does not throw for a well-formed UnprovenTransaction', () =>
    Effect.gen(function* () {
      const facade = yield* setupFacade();
      const wellFormedTx = ledger.Transaction.fromParts(NETWORK_ID);
      yield* Effect.promise(() =>
        expect(
          facade.validateTransaction(wellFormedTx, {
            flags: { enforceBalancing: false, verifySignatures: false, enforceLimits: false },
          }),
        ).resolves.toBeUndefined(),
      );
    }).pipe(Effect.scoped, Effect.runPromise));

  it('throws WellFormedError for a FinalizedTransaction with an expired TTL', () =>
    Effect.gen(function* () {
      const facade = yield* setupFacade();
      yield* Effect.promise(() =>
        expect(facade.validateTransaction(expiredFinalizedTx(), { flags: FULL_STRICTNESS })).rejects.toThrow(
          WellFormedError,
        ),
      );
    }).pipe(Effect.scoped, Effect.runPromise));

  it('throws WellFormedError for a FinalizedTransaction built for the wrong network', () =>
    Effect.gen(function* () {
      const facade = yield* setupFacade();
      yield* Effect.promise(() =>
        expect(facade.validateTransaction(wrongNetworkFinalizedTx(), { flags: FULL_STRICTNESS })).rejects.toThrow(
          WellFormedError,
        ),
      );
    }).pipe(Effect.scoped, Effect.runPromise));

  it('throws WellFormedError for an UnboundTransaction built for the wrong network', () =>
    Effect.gen(function* () {
      const facade = yield* setupFacade();
      const provingService = createSimulatorProvingService();
      const unboundTx = yield* Effect.promise(() => provingService.prove(wrongNetworkUnprovenTx()));
      yield* Effect.promise(() =>
        expect(facade.validateTransaction(unboundTx, { flags: FULL_STRICTNESS })).rejects.toThrow(WellFormedError),
      );
    }).pipe(Effect.scoped, Effect.runPromise));

  it('throws WellFormedError for an UnprovenTransaction built for the wrong network', () =>
    Effect.gen(function* () {
      const facade = yield* setupFacade();
      yield* Effect.promise(() =>
        expect(facade.validateTransaction(wrongNetworkUnprovenTx(), { flags: FULL_STRICTNESS })).rejects.toThrow(
          WellFormedError,
        ),
      );
    }).pipe(Effect.scoped, Effect.runPromise));
});
