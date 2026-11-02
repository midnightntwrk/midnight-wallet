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
 *   Both sides of the boundary are covered, because finalizing depends on which one a stamp is on: an unbound base
 *   transaction is bound as that ledger version's transaction, and an unproven one is proved as one. The facade is the
 *   shipped forking composition over a simulated chain on the side under test, so balancing runs through the V1 variant
 *   below the boundary and the V2 variant from it. Each side is given a prover for its own ledger version only, which
 *   answers whatever version it is asked at; which prover a version is routed to is `versionedProving.test.ts`'s
 *   subject, not this file's.
 *
 *   The handed stamp is deliberately neither the floor of its epoch nor the version the facade is acting at, since a
 *   stamp equal to either would let a re-stamp at the floor, or a re-seal at the acting version, pass for the stamp
 *   being kept. It sits between the two, as a handle adopted earlier does once the chain has moved on within the same
 *   epoch.
 *
 *   Only unshielded tokens are balanced, and nothing is submitted, so no Dust registration or fee is involved. When
 *   shielded or Dust balancing is merged in, the facade stamps the merged transaction at the version it is acting at;
 *   that is a separate decision and is deliberately not pinned here.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  NetworkId,
  ProtocolVersion,
  type UnboundTx,
  type UnprovenTx,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, type Scope } from 'effect';
import { describe, expect, it } from 'vitest';
import { type BalancingRecipe, type WalletFacade } from '../src/index.js';
import {
  createSimulatorProvingService,
  createV8MockProvingService,
  forkingFacadeAt,
  forkingFacadeSchedule,
  v8UnboundOf,
  v9UnboundOf,
} from './utils/index.js';

const NETWORK_ID = NetworkId.NetworkId.Undeployed;

const SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/** What the transactions pay out, less than the wallet holds, so the wallet has to add an input of its own. */
const payout = 50n;

/** An hour from now, on the wall clock this facade runs on: given to the handed transactions and to balancing. */
const ttl = (): Date => new Date(Date.now() + 60 * 60 * 1000);

/** A ledger-v8 transaction paying Night out of one guaranteed intent and spending nothing, so it is short of Night. */
const v8ShortOfNight = (): ledgerV8.UnprovenTransaction => {
  const intent = ledgerV8.Intent.new(ttl());
  // Mutated in place because the ledger's intents are built that way; this is test setup, not wallet code.
  intent.guaranteedUnshieldedOffer = ledgerV8.UnshieldedOffer.new(
    [],
    [
      {
        value: payout,
        owner: ledgerV8.addressFromKey(ledgerV8.signatureVerifyingKey(ledgerV8.sampleSigningKey())),
        type: ledgerV8.nativeToken().raw,
      },
    ],
    [],
  );
  return ledgerV8.Transaction.fromParts(NETWORK_ID, undefined, undefined, intent);
};

/** The ledger-v9 twin of {@link v8ShortOfNight}. */
const v9ShortOfNight = (): ledgerV9.UnprovenTransaction => {
  const intent = ledgerV9.Intent.new(ttl());
  // Mutated in place because the ledger's intents are built that way; this is test setup, not wallet code.
  intent.guaranteedUnshieldedOffer = ledgerV9.UnshieldedOffer.new(
    [],
    [
      {
        value: payout,
        owner: ledgerV9.addressFromKey(ledgerV9.signatureVerifyingKey(ledgerV9.sampleSigningKey())),
        type: ledgerV9.nativeToken().raw,
      },
    ],
    [],
  );
  return ledgerV9.Transaction.fromParts(NETWORK_ID, undefined, undefined, intent);
};

/** What a transaction is handed over as: bytes of whichever ledger version the side runs. */
type Handed = Readonly<{ serialize: () => Uint8Array }>;

const sides = [
  {
    side: 'below the boundary (V1 variant, ledger-v8)',
    handedAt: ProtocolVersion.ProtocolVersion(1_000n),
    chainVersion: ProtocolVersion.ProtocolVersion(2_000n),
    provingService: createV8MockProvingService,
    unproven: (): Handed => v8ShortOfNight(),
    unbound: (): Promise<Handed> => v8UnboundOf(v8ShortOfNight()),
  },
  {
    side: 'from the boundary (V2 variant, ledger-v9)',
    handedAt: ProtocolVersion.ProtocolVersion(forkingFacadeSchedule.v9 + 1_000n),
    chainVersion: ProtocolVersion.ProtocolVersion(forkingFacadeSchedule.v9 + 2_000n),
    provingService: createSimulatorProvingService,
    unproven: (): Handed => v9ShortOfNight(),
    unbound: (): Promise<Handed> => v9UnboundOf(v9ShortOfNight()),
  },
] as const;

type Side = (typeof sides)[number];

/**
 * A facade on `side`'s chain, checked to be set up so that the handed stamp separates a kept stamp from a re-stamp.
 *
 * The stamp has to be strictly inside its epoch, so it is not the floor, and in the same epoch as the chain, so the
 * facade accepts it, but not at the chain's version.
 */
const facadeOn = (side: Side): Effect.Effect<WalletFacade, never, Scope.Scope> => {
  const [floor] = ProtocolVersion.epochOf(side.handedAt, forkingFacadeSchedule.v9);
  expect(side.handedAt).toBeGreaterThan(floor);
  expect(side.handedAt).toBeLessThan(side.chainVersion);
  expect(ProtocolVersion.epochOf(side.chainVersion, forkingFacadeSchedule.v9)).toEqual(
    ProtocolVersion.epochOf(side.handedAt, forkingFacadeSchedule.v9),
  );
  return forkingFacadeAt({
    seed: SEED,
    chainVersion: side.chainVersion,
    overrides: { provingService: side.provingService },
  });
};

/**
 * The precondition every stamp assertion rests on, read off the recipe because the version a recipe carries is the one
 * the facade acts at: were the facade acting at the handed stamp, a re-seal at the acting version would be
 * indistinguishable from the stamp being kept. A precondition rather than a behaviour check — the stamp assertions
 * alone say whether the stamp was kept.
 */
const expectActingElsewhere = (recipe: BalancingRecipe, side: Side): void => {
  expect(recipe.protocolVersion).not.toBe(side.handedAt);
};

describe('WalletFacade keeps the stamp of a transaction it balances in place', () => {
  // Each test checks the recipe before finalizing it, so a failure says which of the two dropped the stamp.
  it.each(sides)('of an unbound transaction, through balancing and finalizing, $side', (side) =>
    Effect.gen(function* () {
      const facade = yield* facadeOn(side);
      const handed: UnboundTx = WalletTransaction.adopt(
        'Unbound',
        yield* Effect.promise(() => side.unbound()),
        side.handedAt,
      );

      const recipe = yield* Effect.promise(() =>
        facade.balanceUnboundTransaction(handed, { ttl: ttl(), tokenKindsToBalance: ['unshielded'] }),
      );
      expectActingElsewhere(recipe, side);

      // No balancing transaction: the base transaction is the one the unshielded wallet balanced in place.
      expect(recipe.balancingTransaction).toBeUndefined();
      expect(recipe.baseTransaction.protocolVersion).toBe(side.handedAt);

      const finalized = yield* Effect.promise(() => facade.finalizeRecipe(recipe));

      expect(finalized.protocolVersion).toBe(side.handedAt);
    }).pipe(Effect.scoped, Effect.runPromise),
  );

  it.each(sides)('of an unproven transaction, through balancing and finalizing, $side', (side) =>
    Effect.gen(function* () {
      const facade = yield* facadeOn(side);
      const handed: UnprovenTx = WalletTransaction.adopt('Unproven', side.unproven(), side.handedAt);

      const recipe = yield* Effect.promise(() =>
        facade.balanceUnprovenTransaction(handed, { ttl: ttl(), tokenKindsToBalance: ['unshielded'] }),
      );
      expectActingElsewhere(recipe, side);

      expect(recipe.transaction.protocolVersion).toBe(side.handedAt);

      const finalized = yield* Effect.promise(() => facade.finalizeRecipe(recipe));

      expect(finalized.protocolVersion).toBe(side.handedAt);
    }).pipe(Effect.scoped, Effect.runPromise),
  );
});
