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
 * Mixed shielded/unshielded swaps are not supported: `initSwap` used to build only the leg matching the input kind and
 * silently drop the counter-leg's requested output, returning a partial transaction that still signed, proved and
 * submitted. It must reject such requests explicitly instead (issue #291).
 *
 * The guard fires before any sync/proving/submission, so these run as fast unit tests in simulation mode.
 */
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
  type SimulatorConfig,
} from './utils/index.js';

vi.setConfig({ testTimeout: 30_000 });

const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const shieldedTokenType = ledger.shieldedToken().raw;
const unshieldedTokenType = ledger.unshieldedToken().raw;

describe('WalletFacade.initSwap mixed-swap rejection', () => {
  const runWithFacade = (assert: (facade: WalletFacade) => Promise<void>) =>
    Effect.gen(function* () {
      const keys = deriveWalletKeys(SEED, NETWORK_ID);
      const genesisMints: [GenesisMint, ...GenesisMint[]] = [
        {
          type: 'shielded',
          tokenType: shieldedTokenType,
          amount: tokenValue(1n),
          recipient: keys.shieldedKeys,
        },
      ];
      const simulator = yield* Simulator.init({ genesisMints, blockProducer: immediateBlockProducer() });
      const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
      const factories = createSimulatorWalletFactories(config);
      const facade = yield* makeSimulatorFacade(config, keys, factories);

      yield* Effect.promise(() => assert(facade));
    }).pipe(Effect.scoped, Effect.runPromise);

  it('rejects a shielded input -> unshielded output swap', async () =>
    runWithFacade(async (facade) => {
      const unshieldedAddress = await facade.unshielded.getAddress();
      const ttl = new Date(Date.now() + 60 * 60 * 1000);

      const desiredInputs: CombinedSwapInputs = { shielded: { [shieldedTokenType]: tokenValue(1n) } };
      const desiredOutputs: CombinedSwapOutputs[] = [
        {
          type: 'unshielded',
          outputs: [{ type: unshieldedTokenType, amount: tokenValue(1n), receiverAddress: unshieldedAddress }],
        },
      ];

      const keys = deriveWalletKeys(SEED, NETWORK_ID);
      await expect(
        facade.initSwap(
          desiredInputs,
          desiredOutputs,
          { shieldedSecretKeys: keys.shieldedKeys, dustSecretKey: keys.dustKey },
          { ttl },
        ),
      ).rejects.toThrow('Mixed shielded/unshielded swaps are not supported.');
    }));

  it('rejects an unshielded input -> shielded output swap', async () =>
    runWithFacade(async (facade) => {
      const shieldedAddress = await facade.shielded.getAddress();
      const ttl = new Date(Date.now() + 60 * 60 * 1000);

      const desiredInputs: CombinedSwapInputs = { unshielded: { [unshieldedTokenType]: tokenValue(1n) } };
      const desiredOutputs: CombinedSwapOutputs[] = [
        {
          type: 'shielded',
          outputs: [{ type: shieldedTokenType, amount: tokenValue(1n), receiverAddress: shieldedAddress }],
        },
      ];

      const keys = deriveWalletKeys(SEED, NETWORK_ID);
      await expect(
        facade.initSwap(
          desiredInputs,
          desiredOutputs,
          { shieldedSecretKeys: keys.shieldedKeys, dustSecretKey: keys.dustKey },
          { ttl },
        ),
      ).rejects.toThrow('Mixed shielded/unshielded swaps are not supported.');
    }));
});
