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

import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion, WalletTransaction } from '@midnightntwrk/wallet-sdk-abstractions';
import { Simulator, immediateBlockProducer, type GenesisMint } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { Effect, Either } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import {
  type CombinedSwapInputs,
  type CombinedSwapOutputs,
  type UnprovenTransactionRecipe,
  type WalletFacade,
} from '../src/index.js';
import {
  createSimulatorWalletFactories,
  deriveWalletKeys,
  makeSimulatorFacade,
  tokenValue,
  waitForShieldedCoins,
  waitForUnshieldedBalance,
  type SimulatorConfig,
} from './utils/index.js';

vi.setConfig({ testTimeout: 60_000 });

const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const shieldedTokenType = ledger.shieldedToken().raw;
const nightTokenType = ledger.nativeToken().raw;

/**
 * Opens the transaction a recipe carries, at exactly the version the recipe says it was built for.
 *
 * @remarks
 *   A one-wide range: the test is asking for the transaction the handle holds and no other, so the version it names is
 *   the recipe's own. Naming the wrong ledger type would fail on the first property read.
 */
const builtTransaction = (recipe: UnprovenTransactionRecipe): ledger.UnprovenTransaction =>
  Either.getOrThrow(
    WalletTransaction.unwrapWithin<ledger.UnprovenTransaction>(
      recipe.transaction,
      ProtocolVersion.makeRange(recipe.protocolVersion, ProtocolVersion.ProtocolVersion(recipe.protocolVersion + 1n)),
    ),
  );

/**
 * Boots a simulator with the given genesis funds, starts a maker facade, and runs `assert` against it. The facade is
 * torn down when the scope closes.
 */
const runWithMaker = (genesisMints: [GenesisMint, ...GenesisMint[]], assert: (facade: WalletFacade) => Promise<void>) =>
  Effect.gen(function* () {
    const keys = deriveWalletKeys(SEED, NETWORK_ID);
    const simulator = yield* Simulator.init({ genesisMints, blockProducer: immediateBlockProducer() });
    const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
    const factories = createSimulatorWalletFactories(config);
    const facade = yield* makeSimulatorFacade(config, keys, factories);
    yield* Effect.promise(() => assert(facade));
  }).pipe(Effect.scoped, Effect.runPromise);

describe('WalletFacade.initSwap builds both legs of a mixed swap', () => {
  it('shielded give -> unshielded want: keeps the unshielded want output', async () =>
    runWithMaker(
      [
        {
          type: 'shielded',
          tokenType: shieldedTokenType,
          amount: tokenValue(10n),
          recipient: deriveWalletKeys(SEED, NETWORK_ID).shieldedKeys,
        },
      ],
      async (facade) => {
        await waitForShieldedCoins(facade).pipe(Effect.runPromise);

        const ttl = new Date(Date.now() + 60 * 60 * 1000);
        const wantAmount = tokenValue(1n);
        const unshieldedAddress = await facade.unshielded.getAddress();

        const desiredInputs: CombinedSwapInputs = { shielded: { [shieldedTokenType]: tokenValue(1n) } };
        const desiredOutputs: CombinedSwapOutputs[] = [
          {
            type: 'unshielded',
            outputs: [{ type: nightTokenType, amount: wantAmount, receiverAddress: unshieldedAddress }],
          },
        ];

        const recipe = await facade.initSwap(desiredInputs, desiredOutputs, { ttl });
        const tx = builtTransaction(recipe);

        // Give side (shielded input) is represented: the single genesis coin is selected.
        expect(tx.guaranteedOffer).toBeDefined();
        expect(tx.guaranteedOffer?.inputs.length).toBe(1);

        // Want side: the requested unshielded output must be present with the exact amount and token.
        const wantOutputs = [...(tx.intents?.values() ?? [])]
          .flatMap((intent) => [
            ...(intent.guaranteedUnshieldedOffer?.outputs ?? []),
            ...(intent.fallibleUnshieldedOffer?.outputs ?? []),
          ])
          .filter((output) => output.type === nightTokenType && output.value === wantAmount);
        expect(wantOutputs).toHaveLength(1);
      },
    ));

  it('unshielded give -> shielded want: keeps the shielded want output', async () =>
    runWithMaker(
      [
        {
          type: 'unshielded',
          tokenType: nightTokenType,
          amount: tokenValue(100n),
          recipient: deriveWalletKeys(SEED, NETWORK_ID).userAddress,
          verifyingKey: deriveWalletKeys(SEED, NETWORK_ID).signatureVerifyingKey,
        },
      ],
      async (facade) => {
        await waitForUnshieldedBalance(facade, nightTokenType, tokenValue(1n)).pipe(Effect.runPromise);

        const ttl = new Date(Date.now() + 60 * 60 * 1000);
        const wantAmount = tokenValue(1n);
        const shieldedAddress = await facade.shielded.getAddress();

        const desiredInputs: CombinedSwapInputs = { unshielded: { [nightTokenType]: tokenValue(1n) } };
        const desiredOutputs: CombinedSwapOutputs[] = [
          {
            type: 'shielded',
            outputs: [{ type: shieldedTokenType, amount: wantAmount, receiverAddress: shieldedAddress }],
          },
        ];

        const recipe = await facade.initSwap(desiredInputs, desiredOutputs, { ttl });
        const tx = builtTransaction(recipe);

        // Give side (unshielded input) is represented as a single intent.
        expect(tx.intents?.size).toBe(1);

        // Want side: the requested shielded output (output-only leg, no change) must be present.
        expect(tx.guaranteedOffer).toBeDefined();
        expect(tx.guaranteedOffer?.outputs.length).toBe(1);
      },
    ));
});
