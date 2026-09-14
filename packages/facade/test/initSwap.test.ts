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
import { Simulator, immediateBlockProducer, type GenesisMint } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { type CombinedSwapInputs, type CombinedSwapOutputs, type WalletFacade } from '../src/index.js';
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
 * Boots a simulator with the given genesis funds, starts a maker facade, and runs `assert` against it. The facade is
 * torn down when the scope closes.
 */
const runWithMaker = (
  genesisMints: [GenesisMint, ...GenesisMint[]],
  assert: (facade: WalletFacade, keys: ReturnType<typeof deriveWalletKeys>) => Promise<void>,
) =>
  Effect.gen(function* () {
    const keys = deriveWalletKeys(SEED, NETWORK_ID);
    const simulator = yield* Simulator.init({ genesisMints, blockProducer: immediateBlockProducer() });
    const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
    const factories = createSimulatorWalletFactories(config);
    const facade = yield* makeSimulatorFacade(config, keys, factories);
    yield* Effect.promise(() => assert(facade, keys));
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
      async (facade, keys) => {
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

        const recipe = await facade.initSwap(
          desiredInputs,
          desiredOutputs,
          { shieldedSecretKeys: keys.shieldedKeys, dustSecretKey: keys.dustKey },
          { ttl },
        );
        const tx = recipe.transaction;

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
      async (facade, keys) => {
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

        const recipe = await facade.initSwap(
          desiredInputs,
          desiredOutputs,
          { shieldedSecretKeys: keys.shieldedKeys, dustSecretKey: keys.dustKey },
          { ttl },
        );
        const tx = recipe.transaction;

        // Give side (unshielded input) is represented as a single intent.
        expect(tx.intents?.size).toBe(1);

        // Want side: the requested shielded output (output-only leg, no change) must be present.
        expect(tx.guaranteedOffer).toBeDefined();
        expect(tx.guaranteedOffer?.outputs.length).toBe(1);
      },
    ));
});
