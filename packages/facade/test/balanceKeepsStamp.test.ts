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
 * Balancing a transaction in place leaves the version it is stamped with alone, all the way to finalizing it.
 *
 * @remarks
 *   A stamp says which version fixed a transaction's bytes. When only unshielded tokens are balanced, the unshielded
 *   wallet adds its inputs and change to the transaction it is handed rather than building a second one, so the facade
 *   hands that same transaction back — as an unbound recipe's base transaction, or as an unproven recipe's transaction
 *   — and finalizes it at the stamp it carries. Adding to the bytes does not make the wallet their author, so the stamp
 *   that went in is the one that comes out, through balancing and through finalizing.
 *
 *   The handed stamp is deliberately neither the floor of its epoch nor the version the facade is acting at. The
 *   simulator's facade acts at the floor, and a stamp equal to either would let a re-stamp at the floor, or a re-seal
 *   at the acting version, pass for the stamp being kept. Each test checks that separation before relying on it. The
 *   stamp sits above the acting version, which no real chain hands over — a handle is stamped at or below the version
 *   the chain has reached — but the simulator acts at the floor, so there is no version below it to pick. Balancing and
 *   finalizing ask only which epoch a stamp falls in, which this one shares with the acting version.
 *
 *   Only unshielded tokens are balanced, and nothing is submitted, so no Dust registration or fee is involved. When
 *   shielded or Dust balancing is merged in, the facade stamps the merged transaction at the version it is acting at;
 *   that is a separate decision and is deliberately not pinned here.
 *
 *   The simulator builds the single-variant wallets, so this pins the facade's part of the path over
 *   `CustomUnshieldedWallet`. Both variants of the forking wallet keep the stamp in their own suite,
 *   `unshielded-wallet/src/test/keepsStamp.test.ts`, and what the facade does with the result does not depend on which
 *   wallet produced it.
 */

import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion, WalletTransaction } from '@midnightntwrk/wallet-sdk-abstractions';
import { Simulator, immediateBlockProducer, type GenesisMint } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { Effect, type Scope } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it } from 'vitest';
import { type WalletFacade } from '../src/index.js';
import {
  createSimulatorWalletFactories,
  deriveWalletKeys,
  makeSimulatorFacade,
  tokenValue,
  waitForUnshieldedBalance,
  type SimulatorConfig,
} from './utils/index.js';

const NETWORK_ID = NetworkId.NetworkId.Undeployed;

const SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const nightTokenType = ledgerV9.nativeToken().raw;

/** The stamp every handed transaction carries: within the simulator's one epoch, and not its floor. */
const handedAt = ProtocolVersion.ProtocolVersion(1_234_001n);

/** What the transactions pay out, less than the wallet holds, so the wallet has to add an input of its own. */
const payout = 50n;

/** A prover that is never asked anything: an unshielded offer has no zero-knowledge proof to make. */
const noProofs = {
  check: () => Promise.resolve([]),
  prove: () => Promise.reject(new Error('An unshielded offer should have nothing to prove')),
  lookupKey: () => Promise.resolve(undefined),
};

/** A transaction paying Night out of one guaranteed intent and spending nothing, so it is short of Night. */
const shortOfNight = (ttl: Date): ledgerV9.UnprovenTransaction => {
  const intent = ledgerV9.Intent.new(ttl);
  // Mutated in place because the ledger's intents are built that way; this is test setup, not wallet code.
  intent.guaranteedUnshieldedOffer = ledgerV9.UnshieldedOffer.new(
    [],
    [
      {
        value: payout,
        owner: ledgerV9.addressFromKey(ledgerV9.signatureVerifyingKey(ledgerV9.sampleSigningKey())),
        type: nightTokenType,
      },
    ],
    [],
  );
  return ledgerV9.Transaction.fromParts(NETWORK_ID, undefined, undefined, intent);
};

/** The same transaction at the unbound stage: proved, which is how a dApp hands one over, and not yet bound. */
const shortOfNightUnbound = (ttl: Date) =>
  shortOfNight(ttl).prove(
    noProofs,
    ledgerV9.LedgerParameters.initialParameters().transactionCostModel.runtimeCostModel,
  );

type Funded = Readonly<{
  facade: WalletFacade;
  /** An hour past the simulator's clock: what both the handed transactions and the balancing are given. */
  ttl: Date;
}>;

/** A simulator facade holding genesis Night, synchronized, and checked to be acting at a version other than the stamp. */
const funded: Effect.Effect<Funded, never, Scope.Scope> = Effect.gen(function* () {
  const keys = deriveWalletKeys(SEED, NETWORK_ID);
  const genesisMints: [GenesisMint] = [
    {
      type: 'unshielded',
      tokenType: nightTokenType,
      amount: tokenValue(1_000n),
      recipient: keys.userAddress,
      verifyingKey: keys.signatureVerifyingKey,
    },
  ];
  const simulator = yield* Simulator.init({ genesisMints, blockProducer: immediateBlockProducer() });
  const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
  const facade = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config));
  yield* waitForUnshieldedBalance(facade, nightTokenType, payout);

  const actingAt = (yield* Effect.promise(() => rx.firstValueFrom(facade.state()))).activeProtocolVersion;
  // The separation every assertion below rests on: a re-stamp at the floor or a re-seal at the acting version would
  // otherwise be indistinguishable from the stamp being kept.
  expect(actingAt).not.toBe(handedAt);
  expect(handedAt).not.toBe(ProtocolVersion.MinSupportedVersion);

  const simulatorTime = yield* simulator.query((state) => state.currentTime);
  return { facade, ttl: new Date(simulatorTime.getTime() + 60 * 60 * 1000) };
});

describe('WalletFacade keeps the stamp of a transaction it balances in place', () => {
  // Each test checks the recipe before finalizing it, so a failure says which of the two dropped the stamp.
  it('of an unbound transaction, through balancing and finalizing', () =>
    Effect.gen(function* () {
      const { facade, ttl } = yield* funded;
      const handed = WalletTransaction.adopt(
        'Unbound',
        yield* Effect.promise(() => shortOfNightUnbound(ttl)),
        handedAt,
      );

      const recipe = yield* Effect.promise(() =>
        facade.balanceUnboundTransaction(handed, { ttl, tokenKindsToBalance: ['unshielded'] }),
      );

      // No balancing transaction: the base transaction is the one the unshielded wallet balanced in place.
      expect(recipe.balancingTransaction).toBeUndefined();
      expect(recipe.protocolVersion).not.toBe(handedAt);
      expect(recipe.baseTransaction.protocolVersion).toBe(handedAt);

      const finalized = yield* Effect.promise(() => facade.finalizeRecipe(recipe));

      expect(finalized.protocolVersion).toBe(handedAt);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('of an unproven transaction, through balancing and finalizing', () =>
    Effect.gen(function* () {
      const { facade, ttl } = yield* funded;
      const handed = WalletTransaction.adopt('Unproven', shortOfNight(ttl), handedAt);

      const recipe = yield* Effect.promise(() =>
        facade.balanceUnprovenTransaction(handed, { ttl, tokenKindsToBalance: ['unshielded'] }),
      );

      expect(recipe.protocolVersion).not.toBe(handedAt);
      expect(recipe.transaction.protocolVersion).toBe(handedAt);

      const finalized = yield* Effect.promise(() => facade.finalizeRecipe(recipe));

      expect(finalized.protocolVersion).toBe(handedAt);
    }).pipe(Effect.scoped, Effect.runPromise));
});
