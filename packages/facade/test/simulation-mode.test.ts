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
 * Simulation Mode Test for WalletFacade
 *
 * This test demonstrates how to use the Simulator for wallet testing without requiring a real blockchain node, proving
 * server, or indexer.
 *
 * Key components:
 *
 * 1. Simulator - provides a simulated ledger with block production
 * 2. Custom wallets with simulator-based sync capabilities
 * 3. Promise-based wrappers for submission and proving services
 *
 * This pattern is suitable for:
 *
 * - Unit tests that need wallet functionality
 * - Integration tests that don't need real chain interaction
 * - DApp connector reference implementation tests
 */
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion, WalletTransaction } from '@midnightntwrk/wallet-sdk-abstractions';
import { V9 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { Effect, pipe } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  type BalancingRecipe,
  type CombinedTokenTransfer,
  type UnprovenTransactionRecipe,
  type FacadeState,
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

vi.setConfig({ testTimeout: 30_000 }); // Fast tests - no real proving or network

const shieldedTokenType = ledger.shieldedToken().raw;
const NETWORK_ID = NetworkId.NetworkId.Undeployed;

const SENDER_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const RECEIVER_SEED = '0000000000000000000000000000000000000000000000000000000000001111';

describe('WalletFacade in simulation mode', () => {
  /**
   * This test demonstrates shielded token transfers in simulation mode with proper fee payment.
   *
   * The test:
   *
   * 1. Creates shielded + Night tokens via genesis mints
   * 2. Registers Night tokens for Dust generation
   * 3. Fast-forwards time to accumulate Dust
   * 4. Performs a shielded transfer with fee payment (default strictness enforces balancing)
   */
  it('allows to transfer shielded tokens between two wallets with fee payment', async () => {
    // Wrap entire test in Effect.gen with Effect.scoped to keep simulator resources alive
    // and automatically clean up facades when the scope closes
    return Effect.gen(function* () {
      // Step 1: Derive keys from seeds
      const senderKeys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);
      const receiverKeys = deriveWalletKeys(RECEIVER_SEED, NETWORK_ID);

      // Step 2: Initialize Simulator with shielded + Night genesis mints
      const nightTokenType = ledger.nativeToken().raw;
      const genesisMints: [V9.GenesisMint, ...V9.GenesisMint[]] = [
        {
          type: 'shielded',
          tokenType: shieldedTokenType,
          amount: tokenValue(1000n),
          recipient: senderKeys.shieldedKeys,
        },
        {
          type: 'unshielded',
          tokenType: nightTokenType,
          amount: tokenValue(100_000n), // Enough Night for Dust generation
          recipient: senderKeys.userAddress,
          verifyingKey: senderKeys.signatureVerifyingKey,
        },
      ];

      // Use default block producer which enforces balancing (requires fee payment)
      const simulator = yield* V9.Simulator.init({
        genesisMints,
        blockProducer: V9.immediateBlockProducer(), // Default strictness enforces balancing
      });

      // Step 3: Create simulator services and wallet factories
      // The simulatorClock reads time from the simulator's state, so the facade's
      // TTL calculations and time-sensitive operations use simulator time instead of Date.now().
      const simulatorConfig: SimulatorConfig = {
        simulator,
        networkId: NETWORK_ID,
        costParameters: { feeBlocksMargin: 5 },
      };

      const factories = createSimulatorWalletFactories(simulatorConfig);

      // Step 4: Initialize WalletFacades for sender and receiver
      // makeSimulatorFacade creates proving/submission services and clock internally
      const senderFacade = yield* makeSimulatorFacade(simulatorConfig, senderKeys, factories);
      const receiverFacade = yield* makeSimulatorFacade(simulatorConfig, receiverKeys, factories);

      // Step 5: Wait for sender wallet to sync and see genesis funds (shielded + Night)
      yield* waitForShieldedCoins(senderFacade);
      yield* waitForUnshieldedBalance(senderFacade, nightTokenType, 1n);

      // Step 6: Fast-forward time so Night UTXOs accumulate "would-be" Dust.
      // Registration pays its own fee via allowFeePayment, which is derived from
      // the Dust that would be generated from the unregistered Night UTXOs.
      // Without elapsed time, generatedNow=0 and registration can't cover its fee.
      yield* simulator.fastForward(10_000n);

      // Step 7: Register Night tokens for Dust generation
      const senderState: FacadeState = yield* Effect.promise(() =>
        rx.firstValueFrom(senderFacade.state().pipe(rx.filter((s) => s.unshielded.availableCoins.length > 0))),
      );

      const nightUtxos = senderState.unshielded.availableCoins.filter(
        (coin) => coin.utxo.type === nightTokenType && coin.meta.registeredForDustGeneration === false,
      );

      expect(nightUtxos.length).toBeGreaterThan(0);

      // Registration transaction's fee is covered by allowFeePayment (would-be generated Dust)
      const dustRegistrationRecipe = yield* Effect.promise(() =>
        senderFacade.registerNightUtxosForDustGeneration(
          nightUtxos,
          senderKeys.signatureVerifyingKey,
          senderKeys.unshieldedKeystore.signDataAsync,
        ),
      );
      const registrationTx = yield* Effect.promise(() => senderFacade.finalizeRecipe(dustRegistrationRecipe));
      yield* Effect.promise(() => senderFacade.submitTransaction(registrationTx));

      // Step 8: Wait for Dust wallet to sync and see accumulated Dust
      yield* Effect.promise(() =>
        rx.firstValueFrom(senderFacade.state().pipe(rx.filter((s) => s.dust.availableCoins.length > 0))),
      );

      // Step 9: Get receiver address and create transfer
      const receiverAddress = yield* Effect.promise(() => receiverFacade.shielded.getAddress());

      // Compute TTL from simulator time (facade uses simulator clock internally for its own TTLs)
      const simTime = yield* simulator.query((s) => s.currentTime);
      const ttl = new Date(simTime.getTime() + 60 * 60 * 1000);
      const transferOutputs: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenType,
              receiverAddress,
              amount: tokenValue(42n),
            },
          ],
        },
      ];

      // Step 8: Create, finalize, and submit the transfer transaction with fee payment
      // payFees: true by default - transaction is balanced with Dust spend
      const transferRecipe: UnprovenTransactionRecipe = yield* Effect.promise(() =>
        senderFacade.transferTransaction(transferOutputs, { ttl }),
      );
      // The recipe carries the block the fee was priced against, so validation checks the transaction against the same
      // parameters rather than fetching a block of its own.
      expect(transferRecipe.blockData?.ledgerParameters).toBeInstanceOf(ledger.LedgerParameters);

      const finalizedTx = yield* Effect.promise(() => senderFacade.finalizeRecipe(transferRecipe));
      const txHash = yield* Effect.promise(() => senderFacade.submitTransaction(finalizedTx));

      expect(txHash).toBeTypeOf('string');

      // Step 11: Wait for receiver wallet to see the transferred funds
      const finalBalance = yield* Effect.promise(() =>
        pipe(
          receiverFacade.state(),
          rx.filter((state) => state.shielded.availableCoins.length > 0),
          rx.map((state) => state.shielded.balances[shieldedTokenType] ?? 0n),
          rx.firstValueFrom,
        ),
      );

      expect(finalBalance).toEqual(tokenValue(42n));

      // Cleanup is automatic via Effect.scoped - facades are stopped when scope closes
    }).pipe(Effect.scoped, Effect.runPromise);
  });

  /**
   * Test that demonstrates the unshielded wallet simulator sync works. This test verifies that Night tokens from
   * rewardNight are visible in the wallet.
   */
  it('syncs Night tokens from rewardNight to unshielded wallet', async () => {
    return Effect.gen(function* () {
      const senderKeys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);

      // Initialize simulator without genesis mints (blank ledger)
      const simulator = yield* V9.Simulator.init({
        blockProducer: V9.immediateBlockProducer(),
      });

      const simulatorConfig: SimulatorConfig = {
        simulator,
        networkId: NETWORK_ID,
        costParameters: { feeBlocksMargin: 5 },
      };

      const factories = createSimulatorWalletFactories(simulatorConfig);

      const senderFacade = yield* makeSimulatorFacade(simulatorConfig, senderKeys, factories);

      // Reward Night tokens to sender
      const nightTokenType = ledger.nativeToken().raw;
      yield* simulator.rewardNight(senderKeys.signatureVerifyingKey, tokenValue(100_000n));

      // Wait for unshielded wallet to sync and see Night tokens
      const nightBalance = yield* waitForUnshieldedBalance(senderFacade, nightTokenType, 1n);

      expect(nightBalance).toEqual(tokenValue(100_000n));
    }).pipe(Effect.scoped, Effect.runPromise);
  });

  it('supports Night tokens in genesis and unshielded transfers', async () => {
    return Effect.gen(function* () {
      const senderKeys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);
      const receiverKeys = deriveWalletKeys(RECEIVER_SEED, NETWORK_ID);
      const nightTokenType = ledger.nativeToken().raw;

      // Genesis: Night tokens for sender (enough for Dust generation + transfer)
      const genesisMints: [V9.GenesisMint] = [
        {
          type: 'unshielded',
          tokenType: nightTokenType,
          amount: tokenValue(100_000n),
          recipient: senderKeys.userAddress,
          verifyingKey: senderKeys.signatureVerifyingKey,
        },
      ];

      // Default block producer enforces balancing (requires fee payment)
      const simulator = yield* V9.Simulator.init({
        genesisMints,
        blockProducer: V9.immediateBlockProducer(),
      });

      const simulatorConfig: SimulatorConfig = {
        simulator,
        networkId: NETWORK_ID,
        costParameters: { feeBlocksMargin: 5 },
      };

      const factories = createSimulatorWalletFactories(simulatorConfig);

      const senderFacade = yield* makeSimulatorFacade(simulatorConfig, senderKeys, factories);
      const receiverFacade = yield* makeSimulatorFacade(simulatorConfig, receiverKeys, factories);

      // Wait for sender to see Night balance from genesis
      yield* waitForUnshieldedBalance(senderFacade, nightTokenType, 1n);

      // Fast-forward for Dust generation, then register Night tokens
      yield* simulator.fastForward(10_000n);

      const senderState: FacadeState = yield* Effect.promise(() =>
        rx.firstValueFrom(senderFacade.state().pipe(rx.filter((s) => s.unshielded.availableCoins.length > 0))),
      );
      const nightUtxos = senderState.unshielded.availableCoins.filter(
        (coin) => coin.utxo.type === nightTokenType && coin.meta.registeredForDustGeneration === false,
      );
      expect(nightUtxos.length).toBeGreaterThan(0);

      const dustRegistrationRecipe = yield* Effect.promise(() =>
        senderFacade.registerNightUtxosForDustGeneration(
          nightUtxos,
          senderKeys.signatureVerifyingKey,
          senderKeys.unshieldedKeystore.signDataAsync,
        ),
      );
      const registrationTx = yield* Effect.promise(() => senderFacade.finalizeRecipe(dustRegistrationRecipe));
      yield* Effect.promise(() => senderFacade.submitTransaction(registrationTx));

      // Wait for Dust to be available
      yield* Effect.promise(() =>
        rx.firstValueFrom(senderFacade.state().pipe(rx.filter((s) => s.dust.availableCoins.length > 0))),
      );

      // Create and submit Night transfer with fee payment
      const receiverAddress = yield* Effect.promise(() => receiverFacade.unshielded.getAddress());
      const simTime = yield* simulator.query((s) => s.currentTime);
      const ttl = new Date(simTime.getTime() + 60 * 60 * 1000);

      const transferRecipe: UnprovenTransactionRecipe = yield* Effect.promise(() =>
        senderFacade.transferTransaction(
          [{ type: 'unshielded', outputs: [{ type: nightTokenType, receiverAddress, amount: tokenValue(100n) }] }],
          { ttl }, // payFees: true (default)
        ),
      );

      const finalizedTx = yield* Effect.promise(() => senderFacade.finalizeRecipe(transferRecipe));
      const txHash = yield* Effect.promise(() => senderFacade.submitTransaction(finalizedTx));
      expect(txHash).toBeTypeOf('string');

      // Wait for receiver to see Night balance
      const receiverBalance = yield* Effect.promise(() =>
        pipe(
          receiverFacade.state(),
          rx.map((s) => s.unshielded.balances[nightTokenType] ?? 0n),
          rx.filter((balance) => balance > 0n),
          rx.firstValueFrom,
        ),
      );
      expect(receiverBalance).toEqual(tokenValue(100n));
    }).pipe(Effect.scoped, Effect.runPromise);
  });

  /**
   * Same flow as the Night transfer test above, but the sender's unshielded wallet uses ECDSA keys. This exercises the
   * full ECDSA spend-authorization path: Dust registration signed with ECDSA and a fee-paying transfer spending
   * ECDSA-owned UTXOs, received by a schnorr wallet.
   */
  it('transfers Night from an ECDSA wallet to a schnorr wallet', async () => {
    return Effect.gen(function* () {
      const senderKeys = deriveWalletKeys(SENDER_SEED, NETWORK_ID, 'ecdsa');
      const receiverKeys = deriveWalletKeys(RECEIVER_SEED, NETWORK_ID, 'schnorr');
      const nightTokenType = ledger.nativeToken().raw;

      // Genesis: Night tokens minted to the sender's ECDSA-derived address
      const genesisMints: [V9.GenesisMint] = [
        {
          type: 'unshielded',
          tokenType: nightTokenType,
          amount: tokenValue(100_000n),
          recipient: senderKeys.userAddress,
          verifyingKey: senderKeys.signatureVerifyingKey,
        },
      ];

      // Default block producer enforces balancing (requires fee payment)
      const simulator = yield* V9.Simulator.init({
        genesisMints,
        blockProducer: V9.immediateBlockProducer(),
      });

      const simulatorConfig: SimulatorConfig = {
        simulator,
        networkId: NETWORK_ID,
        costParameters: { feeBlocksMargin: 5 },
      };

      const factories = createSimulatorWalletFactories(simulatorConfig);

      const senderFacade = yield* makeSimulatorFacade(simulatorConfig, senderKeys, factories);
      const receiverFacade = yield* makeSimulatorFacade(simulatorConfig, receiverKeys, factories);

      // Wait for sender to see Night balance from genesis at its ECDSA address
      yield* waitForUnshieldedBalance(senderFacade, nightTokenType, 1n);

      // Fast-forward for Dust generation, then register Night tokens (signed with the ECDSA keystore)
      yield* simulator.fastForward(10_000n);

      const senderState: FacadeState = yield* Effect.promise(() =>
        rx.firstValueFrom(senderFacade.state().pipe(rx.filter((s) => s.unshielded.availableCoins.length > 0))),
      );
      const nightUtxos = senderState.unshielded.availableCoins.filter(
        (coin) => coin.utxo.type === nightTokenType && coin.meta.registeredForDustGeneration === false,
      );
      expect(nightUtxos.length).toBeGreaterThan(0);

      const dustRegistrationRecipe = yield* Effect.promise(() =>
        senderFacade.registerNightUtxosForDustGeneration(
          nightUtxos,
          senderKeys.signatureVerifyingKey,
          senderKeys.unshieldedKeystore.signDataAsync,
        ),
      );
      const registrationTx = yield* Effect.promise(() => senderFacade.finalizeRecipe(dustRegistrationRecipe));
      yield* Effect.promise(() => senderFacade.submitTransaction(registrationTx));

      // Wait for Dust to be available
      yield* Effect.promise(() =>
        rx.firstValueFrom(senderFacade.state().pipe(rx.filter((s) => s.dust.availableCoins.length > 0))),
      );

      // Create and submit Night transfer with fee payment, spending ECDSA-owned UTXOs
      const receiverAddress = yield* Effect.promise(() => receiverFacade.unshielded.getAddress());
      const simTime = yield* simulator.query((s) => s.currentTime);
      const ttl = new Date(simTime.getTime() + 60 * 60 * 1000);

      const transferRecipe: UnprovenTransactionRecipe = yield* Effect.promise(() =>
        senderFacade.transferTransaction(
          [{ type: 'unshielded', outputs: [{ type: nightTokenType, receiverAddress, amount: tokenValue(100n) }] }],
          { ttl }, // payFees: true (default)
        ),
      );

      const finalizedTx = yield* Effect.promise(() => senderFacade.finalizeRecipe(transferRecipe));
      const txHash = yield* Effect.promise(() => senderFacade.submitTransaction(finalizedTx));
      expect(txHash).toBeTypeOf('string');

      // Wait for the schnorr receiver to see the Night balance
      const receiverBalance = yield* waitForUnshieldedBalance(receiverFacade, nightTokenType, 1n);
      expect(receiverBalance).toEqual(tokenValue(100n));
    }).pipe(Effect.scoped, Effect.runPromise);
  });

  /**
   * Same flow with the kinds flipped: a schnorr wallet sends Night to an ECDSA wallet's address. This exercises
   * ownership detection on receive for ECDSA-derived addresses.
   */
  it('transfers Night from a schnorr wallet to an ECDSA wallet', async () => {
    return Effect.gen(function* () {
      const senderKeys = deriveWalletKeys(SENDER_SEED, NETWORK_ID, 'schnorr');
      const receiverKeys = deriveWalletKeys(RECEIVER_SEED, NETWORK_ID, 'ecdsa');
      const nightTokenType = ledger.nativeToken().raw;

      // Genesis: Night tokens for the schnorr sender
      const genesisMints: [V9.GenesisMint] = [
        {
          type: 'unshielded',
          tokenType: nightTokenType,
          amount: tokenValue(100_000n),
          recipient: senderKeys.userAddress,
          verifyingKey: senderKeys.signatureVerifyingKey,
        },
      ];

      // Default block producer enforces balancing (requires fee payment)
      const simulator = yield* V9.Simulator.init({
        genesisMints,
        blockProducer: V9.immediateBlockProducer(),
      });

      const simulatorConfig: SimulatorConfig = {
        simulator,
        networkId: NETWORK_ID,
        costParameters: { feeBlocksMargin: 5 },
      };

      const factories = createSimulatorWalletFactories(simulatorConfig);

      const senderFacade = yield* makeSimulatorFacade(simulatorConfig, senderKeys, factories);
      const receiverFacade = yield* makeSimulatorFacade(simulatorConfig, receiverKeys, factories);

      // Wait for sender to see Night balance from genesis
      yield* waitForUnshieldedBalance(senderFacade, nightTokenType, 1n);

      // Fast-forward for Dust generation, then register Night tokens
      yield* simulator.fastForward(10_000n);

      const senderState: FacadeState = yield* Effect.promise(() =>
        rx.firstValueFrom(senderFacade.state().pipe(rx.filter((s) => s.unshielded.availableCoins.length > 0))),
      );
      const nightUtxos = senderState.unshielded.availableCoins.filter(
        (coin) => coin.utxo.type === nightTokenType && coin.meta.registeredForDustGeneration === false,
      );
      expect(nightUtxos.length).toBeGreaterThan(0);

      const dustRegistrationRecipe = yield* Effect.promise(() =>
        senderFacade.registerNightUtxosForDustGeneration(
          nightUtxos,
          senderKeys.signatureVerifyingKey,
          senderKeys.unshieldedKeystore.signDataAsync,
        ),
      );
      const registrationTx = yield* Effect.promise(() => senderFacade.finalizeRecipe(dustRegistrationRecipe));
      yield* Effect.promise(() => senderFacade.submitTransaction(registrationTx));

      // Wait for Dust to be available
      yield* Effect.promise(() =>
        rx.firstValueFrom(senderFacade.state().pipe(rx.filter((s) => s.dust.availableCoins.length > 0))),
      );

      // Create and submit Night transfer to the ECDSA wallet's address
      const receiverAddress = yield* Effect.promise(() => receiverFacade.unshielded.getAddress());
      const simTime = yield* simulator.query((s) => s.currentTime);
      const ttl = new Date(simTime.getTime() + 60 * 60 * 1000);

      const transferRecipe: UnprovenTransactionRecipe = yield* Effect.promise(() =>
        senderFacade.transferTransaction(
          [{ type: 'unshielded', outputs: [{ type: nightTokenType, receiverAddress, amount: tokenValue(100n) }] }],
          { ttl }, // payFees: true (default)
        ),
      );

      const finalizedTx = yield* Effect.promise(() => senderFacade.finalizeRecipe(transferRecipe));
      const txHash = yield* Effect.promise(() => senderFacade.submitTransaction(finalizedTx));
      expect(txHash).toBeTypeOf('string');

      // Wait for the ECDSA receiver to see the Night balance
      const receiverBalance = yield* waitForUnshieldedBalance(receiverFacade, nightTokenType, 1n);
      expect(receiverBalance).toEqual(tokenValue(100n));
    }).pipe(Effect.scoped, Effect.runPromise);
  });
});

describe('A recipe that pays a fee', () => {
  const nightTokenType = ledger.nativeToken().raw;

  /** A facade whose Night is registered for Dust generation, holding the Dust to pay fees with. */
  const facadeWithDust = Effect.gen(function* () {
    const keys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);
    const simulator = yield* V9.Simulator.init({
      genesisMints: [
        {
          type: 'unshielded',
          tokenType: nightTokenType,
          amount: tokenValue(100_000n),
          recipient: keys.userAddress,
          verifyingKey: keys.signatureVerifyingKey,
        },
      ],
      blockProducer: V9.immediateBlockProducer(),
    });
    const simulatorConfig: SimulatorConfig = {
      simulator,
      networkId: NETWORK_ID,
      costParameters: { feeBlocksMargin: 5 },
    };
    const facade = yield* makeSimulatorFacade(simulatorConfig, keys, createSimulatorWalletFactories(simulatorConfig));
    yield* waitForUnshieldedBalance(facade, nightTokenType, 1n);

    // Registration pays its own fee out of the Dust its Night would have generated, so time has to pass first.
    yield* simulator.fastForward(10_000n);
    const registering: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
    const registrationRecipe = yield* Effect.promise(() =>
      facade.registerNightUtxosForDustGeneration(
        registering.unshielded.availableCoins,
        keys.signatureVerifyingKey,
        keys.unshieldedKeystore.signDataAsync,
      ),
    );
    const registration = yield* Effect.promise(() => facade.finalizeRecipe(registrationRecipe));
    yield* Effect.promise(() => facade.submitTransaction(registration));
    yield* Effect.promise(() =>
      rx.firstValueFrom(
        facade
          .state()
          .pipe(
            rx.filter(
              (s) =>
                s.dust.availableCoins.length > 0 &&
                s.unshielded.availableCoins.length > 0 &&
                s.unshielded.pendingCoins.length === 0,
            ),
          ),
      ),
    );

    const simTime = yield* simulator.query((s) => s.currentTime);
    return { facade, ttl: new Date(simTime.getTime() + 60 * 60 * 1000) };
  });

  // A caller's transaction with nothing in it, so the only balancing it needs is its fee.
  const callersTransaction = () => ledger.Transaction.fromParts(NETWORK_ID);
  const sealed = <TStage extends WalletTransaction.Stage>(stage: TStage, tx: { serialize: () => Uint8Array }) =>
    WalletTransaction.adopt(stage, tx, ProtocolVersion.MinSupportedVersion);

  const builders: ReadonlyArray<readonly [string, (facade: WalletFacade, ttl: Date) => Promise<BalancingRecipe>]> = [
    [
      'transferTransaction',
      async (facade, ttl) =>
        facade.transferTransaction(
          [
            {
              type: 'unshielded',
              outputs: [
                { type: nightTokenType, receiverAddress: await facade.unshielded.getAddress(), amount: tokenValue(1n) },
              ],
            },
          ],
          { ttl, payFees: true },
        ),
    ],
    [
      'initSwap',
      async (facade, ttl) =>
        facade.initSwap(
          { unshielded: { [nightTokenType]: tokenValue(1n) } },
          [
            {
              type: 'shielded',
              outputs: [
                {
                  type: shieldedTokenType,
                  receiverAddress: await facade.shielded.getAddress(),
                  amount: tokenValue(1n),
                },
              ],
            },
          ],
          { ttl, payFees: true },
        ),
    ],
    [
      'balanceUnprovenTransaction',
      (facade, ttl) =>
        facade.balanceUnprovenTransaction(sealed('Unproven', callersTransaction()), {
          ttl,
          tokenKindsToBalance: ['dust'],
        }),
    ],
    [
      'balanceUnboundTransaction',
      (facade, ttl) =>
        facade.balanceUnboundTransaction(sealed('Unbound', callersTransaction().mockProve()), {
          ttl,
          tokenKindsToBalance: ['dust'],
        }),
    ],
    [
      'balanceFinalizedTransaction',
      (facade, ttl) =>
        facade.balanceFinalizedTransaction(sealed('Finalized', callersTransaction().mockProve().bind()), {
          ttl,
          tokenKindsToBalance: ['dust'],
        }),
    ],
  ];

  it.each(builders)(
    'should carry the block its fee was priced against when built by %s, so validation checks it against the same parameters',
    (_, build) =>
      Effect.gen(function* () {
        const { facade, ttl } = yield* facadeWithDust;
        const recipe = yield* Effect.promise(() => build(facade, ttl));
        expect(recipe.blockData?.ledgerParameters).toBeInstanceOf(ledger.LedgerParameters);
      }).pipe(Effect.scoped, Effect.runPromise),
  );
});
