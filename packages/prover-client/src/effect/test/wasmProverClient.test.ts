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
import {
  CostModel,
  createShieldedCoinInfo,
  LedgerParameters,
  sampleCoinPublicKey,
  sampleEncryptionPublicKey,
  shieldedToken,
  Transaction,
  ZswapOffer,
  ZswapOutput,
} from '@midnight-ntwrk/ledger-v7';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as WasmProver from '../WasmProver.js';
import * as ProverClient from '../ProverClient.js';

const timeout_minutes = (mins: number) => 1_000 * 60 * mins;
const wasmConfig = { keyMaterialProvider: WasmProver.makeDefaultKeyMaterialProvider() };

describe('WasmProver', () => {
  const shieldedTokenType = shieldedToken() as { raw: string; tag: 'shielded' };
  const makeValidTransaction = (spendCoinAmount: bigint) => {
    const spendCoin = createShieldedCoinInfo(shieldedTokenType.raw, spendCoinAmount);
    const cpk = sampleCoinPublicKey();
    const epk = sampleEncryptionPublicKey();
    const output = ZswapOutput.new(spendCoin, 0, cpk, epk);
    const unprovenOffer = ZswapOffer.fromOutput(output, shieldedTokenType.raw, spendCoinAmount);

    return Transaction.fromParts('undeployed', unprovenOffer);
  };

  it(
    'should prove a valid transaction using the default wasm prover',
    async () => {
      await Effect.gen(function* () {
        const proveClient = yield* ProverClient.ProverClient;
        const spendCoinAmount = 1_000n;

        const validTx = makeValidTransaction(spendCoinAmount);
        const tx = yield* proveClient.proveTransaction(validTx, CostModel.initialCostModel());
        const imbalances = tx.imbalances(0, tx.fees(LedgerParameters.initialParameters()));

        // workaround because imbalances keys are objects, while js compares them by reference
        const filteredImbalances = Array.from(imbalances.entries()).filter(
          ([tokenType, tokenValue]) => tokenType.tag === shieldedTokenType.tag && tokenValue <= spendCoinAmount,
        );

        expect(filteredImbalances.length).toEqual(1);
        expect(tx.fees(LedgerParameters.initialParameters())).not.toEqual(0n);
      }).pipe(
        Effect.provide(WasmProver.layer(wasmConfig)),
        Effect.catchAll((err) => Effect.fail(`Encountered unexpected '${err._tag}' error: ${err.message}`)),
        Effect.runPromise,
      );
    },
    timeout_minutes(5),
  );

  it(
    'should prove a valid transaction using a custom wasm prover',
    async () => {
      await Effect.gen(function* () {
        const provingService = yield* WasmProver.create(wasmConfig);
        const spendCoinAmount = 1_000n;

        const validTx = makeValidTransaction(spendCoinAmount);
        const tx = yield* provingService.proveTransaction(validTx, CostModel.initialCostModel());
        const imbalances = tx.imbalances(0, tx.fees(LedgerParameters.initialParameters()));

        // workaround because imbalances keys are objects, while js compares them by reference
        const filteredImbalances = Array.from(imbalances.entries()).filter(
          ([tokenType, tokenValue]) => tokenType.tag === shieldedTokenType.tag && tokenValue <= spendCoinAmount,
        );

        expect(filteredImbalances.length).toEqual(1);
        expect(tx.fees(LedgerParameters.initialParameters())).not.toEqual(0n);
      }).pipe(
        Effect.catchAll((err) => Effect.fail(`Encountered unexpected '${err._tag}' error: ${err.message}`)),
        Effect.runPromise,
      );
    },
    timeout_minutes(5),
  );

  it(
    'should fail to prove an invalid transaction',
    async () => {
      await Effect.gen(function* () {
        const proveClient = yield* ProverClient.ProverClient;

        const tx = makeValidTransaction(1n);

        yield* proveClient.proveTransaction(tx, CostModel.initialCostModel());
      }).pipe(
        Effect.catchAll(() => Effect.succeed(void 0)),
        Effect.provide(WasmProver.layer(wasmConfig)),
        Effect.catchAll((err) => Effect.fail(`Encountered unexpected '${err._tag}' error: ${err.message}`)),
        Effect.runPromise,
      );
    },
    timeout_minutes(5),
  );
});
