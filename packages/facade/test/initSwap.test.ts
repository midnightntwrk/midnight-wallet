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
import * as rx from 'rxjs';
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
 * The guaranteed section's imbalance per token, keyed `<kind>:<raw type>`: positive for what the transaction gives,
 * negative for what it asks for. Dust is left out, being fee payment rather than either leg of the swap.
 *
 * @remarks
 *   Shielded outputs are encrypted, so the imbalance is the one place a shielded want's token and amount can be read.
 */
const swapImbalances = (tx: ledger.UnprovenTransaction): Record<string, bigint> =>
  Object.fromEntries(
    [...tx.imbalances(0).entries()].flatMap(([token, value]) =>
      token.tag === 'dust' ? [] : [[`${token.tag}:${token.raw}`, value] as const],
    ),
  );

/** The guaranteed section's Dust imbalance: positive once Dust is spent towards the fee, zero when nothing pays it. */
const dustImbalance = (tx: ledger.UnprovenTransaction): bigint =>
  [...tx.imbalances(0).entries()].find(([token]) => token.tag === 'dust')?.[1] ?? 0n;

type MakerKeys = ReturnType<typeof deriveWalletKeys>;

/**
 * Boots a simulator with the given genesis funds, starts a maker facade, and runs `assert` against it. The facade is
 * torn down when the scope closes.
 */
const runWithMaker = (
  genesisMints: [GenesisMint, ...GenesisMint[]],
  assert: (facade: WalletFacade, env: { simulator: Simulator; keys: MakerKeys }) => Promise<void>,
) =>
  Effect.gen(function* () {
    const keys = deriveWalletKeys(SEED, NETWORK_ID);
    const simulator = yield* Simulator.init({ genesisMints, blockProducer: immediateBlockProducer() });
    const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
    const factories = createSimulatorWalletFactories(config);
    const facade = yield* makeSimulatorFacade(config, keys, factories);
    yield* Effect.promise(() => assert(facade, { simulator, keys }));
  }).pipe(Effect.scoped, Effect.runPromise);

const shieldedGenesis = (amount: bigint): GenesisMint => ({
  type: 'shielded',
  tokenType: shieldedTokenType,
  amount,
  recipient: deriveWalletKeys(SEED, NETWORK_ID).shieldedKeys,
});

const nightGenesis = (amount: bigint): GenesisMint => ({
  type: 'unshielded',
  tokenType: nightTokenType,
  amount,
  recipient: deriveWalletKeys(SEED, NETWORK_ID).userAddress,
  verifyingKey: deriveWalletKeys(SEED, NETWORK_ID).signatureVerifyingKey,
});

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

        // Exactly the requested amounts: the shielded give is offered, the unshielded want is asked for.
        expect(swapImbalances(tx)).toEqual({
          [`shielded:${shieldedTokenType}`]: tokenValue(1n),
          [`unshielded:${nightTokenType}`]: -wantAmount,
        });
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

        // Exactly the requested amounts: the unshielded give is offered, the shielded want is asked for.
        expect(swapImbalances(tx)).toEqual({
          [`unshielded:${nightTokenType}`]: tokenValue(1n),
          [`shielded:${shieldedTokenType}`]: -wantAmount,
        });
      },
    ));

  it('keeps every want of either kind, however the outputs are grouped', async () =>
    runWithMaker([shieldedGenesis(tokenValue(10n))], async (facade) => {
      await waitForShieldedCoins(facade).pipe(Effect.runPromise);

      const otherShieldedTokenType = ledger.sampleRawTokenType();
      const ttl = new Date(Date.now() + 60 * 60 * 1000);
      const unshieldedAddress = await facade.unshielded.getAddress();
      const shieldedAddress = await facade.shielded.getAddress();

      // Two unshielded groups around a shielded one: a want in any group, of either kind, must survive.
      const desiredOutputs: CombinedSwapOutputs[] = [
        {
          type: 'unshielded',
          outputs: [{ type: nightTokenType, amount: tokenValue(1n), receiverAddress: unshieldedAddress }],
        },
        {
          type: 'shielded',
          outputs: [{ type: otherShieldedTokenType, amount: tokenValue(2n), receiverAddress: shieldedAddress }],
        },
        {
          type: 'unshielded',
          outputs: [{ type: nightTokenType, amount: tokenValue(3n), receiverAddress: unshieldedAddress }],
        },
      ];

      const recipe = await facade.initSwap({ shielded: { [shieldedTokenType]: tokenValue(1n) } }, desiredOutputs, {
        ttl,
      });

      expect(swapImbalances(builtTransaction(recipe))).toEqual({
        [`shielded:${shieldedTokenType}`]: tokenValue(1n),
        [`shielded:${otherShieldedTokenType}`]: -tokenValue(2n),
        [`unshielded:${nightTokenType}`]: -tokenValue(4n),
      });
    }));

  it('keeps both legs when it also pays the fee, adding a Dust spend beside them', async () =>
    runWithMaker([shieldedGenesis(tokenValue(10n)), nightGenesis(tokenValue(100_000n))], async (facade, env) => {
      await waitForShieldedCoins(facade).pipe(Effect.runPromise);
      await waitForUnshieldedBalance(facade, nightTokenType, 1n).pipe(Effect.runPromise);

      // Dust to pay with: let the Night accrue some, register it (paying from what it accrued), wait to see the Dust.
      await env.simulator.fastForward(10_000n).pipe(Effect.runPromise);
      const { unshielded } = await rx.firstValueFrom(
        facade.state().pipe(rx.filter((state) => state.unshielded.availableCoins.length > 0)),
      );
      const registration = await facade.registerNightUtxosForDustGeneration(
        unshielded.availableCoins.filter((coin) => coin.utxo.type === nightTokenType),
        env.keys.signatureVerifyingKey,
        env.keys.unshieldedKeystore.signDataAsync,
      );
      await facade.submitTransaction(await facade.finalizeRecipe(registration));
      await rx.firstValueFrom(facade.state().pipe(rx.filter((state) => state.dust.availableCoins.length > 0)));

      const simulatorTime = await env.simulator.query((state) => state.currentTime).pipe(Effect.runPromise);
      const ttl = new Date(simulatorTime.getTime() + 60 * 60 * 1000);
      const wantAmount = tokenValue(1n);
      const unshieldedAddress = await facade.unshielded.getAddress();

      const recipe = await facade.initSwap(
        { shielded: { [shieldedTokenType]: tokenValue(1n) } },
        [
          {
            type: 'unshielded',
            outputs: [{ type: nightTokenType, amount: wantAmount, receiverAddress: unshieldedAddress }],
          },
        ],
        { ttl, payFees: true },
      );
      const tx = builtTransaction(recipe);

      expect(swapImbalances(tx)).toEqual({
        [`shielded:${shieldedTokenType}`]: tokenValue(1n),
        [`unshielded:${nightTokenType}`]: -wantAmount,
      });
      expect(dustImbalance(tx)).toBeGreaterThan(0n);
    }));
});

// A swap with no part of either kind has nothing to offer and nothing to ask for, so there is no transaction to build.
describe('WalletFacade.initSwap rejects a swap with no legs', () => {
  const ttl = () => new Date(Date.now() + 60 * 60 * 1000);

  it('rejects a swap with no inputs and no outputs, however the emptiness is spelled', async () =>
    runWithMaker([shieldedGenesis(tokenValue(10n))], async (facade) => {
      await expect(facade.initSwap({}, [], { ttl: ttl() })).rejects.toThrow(
        'At least one shielded or unshielded swap is required.',
      );
      // Empty input records and empty output groups name a kind without giving or asking for any of it.
      await expect(
        facade.initSwap(
          { shielded: {}, unshielded: {} },
          [
            { type: 'shielded', outputs: [] },
            { type: 'unshielded', outputs: [] },
          ],
          { ttl: ttl() },
        ),
      ).rejects.toThrow('At least one shielded or unshielded swap is required.');
    }));
});
