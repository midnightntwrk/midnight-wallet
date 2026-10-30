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
import {
  InMemoryTransactionHistoryStorage,
  NetworkId,
  ProtocolVersion,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { Simulator, immediateBlockProducer, type GenesisMint } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { Effect, Either } from 'effect';
import * as rx from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type CombinedSwapInputs,
  type CombinedSwapOutputs,
  type DefaultConfiguration,
  type UnprovenTransactionRecipe,
  WalletEntrySchema,
  WalletFacade,
  mergeWalletEntries,
} from '../src/index.js';
import {
  createSimulatorWalletFactories,
  createV8MockProvingService,
  deriveWalletKeys,
  makeSimulatorFacade,
  SilentPendingTransactions,
  tokenValue,
  waitForShieldedCoins,
  waitForUnshieldedBalance,
  type SimulatorConfig,
} from './utils/index.js';

vi.setConfig({ testTimeout: 60_000 });

const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const FEE_BLOCKS_MARGIN = 5;
const SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const KEYS = deriveWalletKeys(SEED, NETWORK_ID);

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

/**
 * The guaranteed section's Dust imbalance once `fee` is charged against it: negative when the Dust spent falls short of
 * the fee, zero or more when it covers it.
 */
const dustImbalanceAfterFee = (tx: ledger.UnprovenTransaction, fee: bigint): bigint =>
  [...tx.imbalances(0, fee).entries()].find(([token]) => token.tag === 'dust')?.[1] ?? 0n;

/**
 * Boots a simulator with the given genesis funds, starts a maker facade, and runs `assert` against it. The facade is
 * torn down when the scope closes.
 */
const runWithMaker = (
  genesisMints: [GenesisMint, ...GenesisMint[]],
  assert: (facade: WalletFacade, env: { simulator: Simulator }) => Promise<void>,
) =>
  Effect.gen(function* () {
    const simulator = yield* Simulator.init({ genesisMints, blockProducer: immediateBlockProducer() });
    const config: SimulatorConfig = {
      simulator,
      networkId: NETWORK_ID,
      costParameters: { feeBlocksMargin: FEE_BLOCKS_MARGIN },
    };
    const factories = createSimulatorWalletFactories(config);
    const facade = yield* makeSimulatorFacade(config, KEYS, factories);
    yield* Effect.promise(() => assert(facade, { simulator }));
  }).pipe(Effect.scoped, Effect.runPromise);

const shieldedGenesis = (amount: bigint): GenesisMint => ({
  type: 'shielded',
  tokenType: shieldedTokenType,
  amount,
  recipient: KEYS.shieldedKeys,
});

const nightGenesis = (amount: bigint): GenesisMint => ({
  type: 'unshielded',
  tokenType: nightTokenType,
  amount,
  recipient: KEYS.userAddress,
  verifyingKey: KEYS.signatureVerifyingKey,
});

describe('WalletFacade.initSwap builds both legs of a mixed swap', () => {
  it('shielded give -> unshielded want: keeps the unshielded want output', async () =>
    runWithMaker([shieldedGenesis(tokenValue(10n))], async (facade) => {
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

      // Want side: the requested unshielded output must be present with the exact amount and token, in the
      // guaranteed offer, which is the section the imbalances below read.
      const wantOutputs = [...(tx.intents?.values() ?? [])]
        .flatMap((intent) => intent.guaranteedUnshieldedOffer?.outputs ?? [])
        .filter((output) => output.type === nightTokenType && output.value === wantAmount);
      expect(wantOutputs).toHaveLength(1);

      // Exactly the requested amounts: the shielded give is offered, the unshielded want is asked for.
      expect(swapImbalances(tx)).toEqual({
        [`shielded:${shieldedTokenType}`]: tokenValue(1n),
        [`unshielded:${nightTokenType}`]: -wantAmount,
      });
    }));

  it('unshielded give -> shielded want: keeps the shielded want output', async () =>
    runWithMaker([nightGenesis(tokenValue(100n))], async (facade) => {
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
    }));

  it('keeps every want of either kind, however the outputs are grouped', async () =>
    runWithMaker([shieldedGenesis(tokenValue(10n))], async (facade) => {
      await waitForShieldedCoins(facade).pipe(Effect.runPromise);

      const otherShieldedTokenType = ledger.sampleRawTokenType();
      const ttl = new Date(Date.now() + 60 * 60 * 1000);
      const unshieldedAddress = await facade.unshielded.getAddress();
      const shieldedAddress = await facade.shielded.getAddress();

      // Groups of each kind interleaved, two of each: a want in any group, of either kind, must survive.
      const thirdShieldedTokenType = ledger.sampleRawTokenType();
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
        {
          type: 'shielded',
          outputs: [{ type: thirdShieldedTokenType, amount: tokenValue(5n), receiverAddress: shieldedAddress }],
        },
      ];

      const recipe = await facade.initSwap({ shielded: { [shieldedTokenType]: tokenValue(1n) } }, desiredOutputs, {
        ttl,
      });

      const tx = builtTransaction(recipe);

      expect(swapImbalances(tx)).toEqual({
        [`shielded:${shieldedTokenType}`]: tokenValue(1n),
        [`shielded:${otherShieldedTokenType}`]: -tokenValue(2n),
        [`shielded:${thirdShieldedTokenType}`]: -tokenValue(5n),
        [`unshielded:${nightTokenType}`]: -tokenValue(4n),
      });
      // The imbalance sums a token's wants, so it cannot tell two outputs from one merged output of the same total:
      // each requested output must be there as asked. The ledger keeps an offer's outputs in its own order.
      const nightOutputs = [...(tx.intents?.values() ?? [])]
        .flatMap((intent) => intent.guaranteedUnshieldedOffer?.outputs ?? [])
        .filter((output) => output.type === nightTokenType)
        .map((output) => output.value);
      expect(nightOutputs).toHaveLength(2);
      expect(nightOutputs).toEqual(expect.arrayContaining([tokenValue(1n), tokenValue(3n)]));
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
        KEYS.signatureVerifyingKey,
        KEYS.unshieldedKeystore.signDataAsync,
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
      // The Dust spent must cover the whole fee, not merely be some: the fee as the balancer prices it, on the
      // proof-erased transaction with the block margin the facade is configured with.
      const ledgerParams = await env.simulator.query((state) => state.ledger.parameters).pipe(Effect.runPromise);
      const fee = tx.eraseProofs().feesWithMargin(ledgerParams, FEE_BLOCKS_MARGIN);
      expect(fee).toBeGreaterThan(0n);
      expect(dustImbalanceAfterFee(tx, fee)).toBeGreaterThanOrEqual(0n);
    }));
});

// A swap with no part of either kind has nothing to offer and nothing to ask for, so there is no transaction to build.
describe('WalletFacade.initSwap rejects a swap with no legs', () => {
  const facades: WalletFacade[] = [];

  afterEach(async () => {
    await Promise.allSettled(facades.splice(0).map((facade) => facade.stop()));
  });

  /**
   * A facade over the shipped wallets, never started. The emptiness is decided from the arguments alone, before any
   * wallet is reached, so there is no chain to sync and nothing to fund.
   */
  const unstartedFacade = async (): Promise<WalletFacade> => {
    const facade = await WalletFacade.init({
      configuration: {
        networkId: NETWORK_ID,
        relayURL: new URL('http://localhost:9944'),
        indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
        provingServerUrl: new URL('http://localhost:6300'),
        costParameters: { feeBlocksMargin: FEE_BLOCKS_MARGIN },
        txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
      } satisfies DefaultConfiguration,
      shielded: (config) => ShieldedWallet(config).startWithSeed(KEYS.seeds.shielded),
      unshielded: (config) =>
        UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(KEYS.unshieldedKeystore)),
      dust: (config) => DustWallet(config).startWithSeed(KEYS.seeds.dust),
      provingService: () => createV8MockProvingService(),
      pendingTransactionsService: () => new SilentPendingTransactions(),
    });
    facades.push(facade);
    return facade;
  };

  it.each<{ spelling: string; inputs: CombinedSwapInputs; outputs: CombinedSwapOutputs[] }>([
    { spelling: 'nothing at all', inputs: {}, outputs: [] },
    {
      // Each kind is named without giving or asking for any of it.
      spelling: 'empty input records and empty output groups',
      inputs: { shielded: {}, unshielded: {} },
      outputs: [
        { type: 'shielded', outputs: [] },
        { type: 'unshielded', outputs: [] },
      ],
    },
  ])('rejects a swap with no inputs and no outputs, spelled as $spelling', async ({ inputs, outputs }) => {
    const facade = await unstartedFacade();

    await expect(facade.initSwap(inputs, outputs, { ttl: new Date(Date.now() + 60 * 60 * 1000) })).rejects.toThrow(
      'At least one shielded or unshielded swap is required.',
    );
  });
});
