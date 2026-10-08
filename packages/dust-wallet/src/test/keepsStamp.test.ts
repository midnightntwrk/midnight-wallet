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
 * A dust wallet leaves alone the stamp of a transaction it changes in place.
 *
 * @remarks
 *   A stamp says which protocol version fixed a transaction's bytes. A transaction the wallet builds for itself is
 *   stamped with the floor of the epoch its variant owns. A transaction it is handed and changes in place — attaches a
 *   registration to, or signs one on — was fixed by whoever built it, which for a registration is the unshielded
 *   wallet, and adding to it does not make the dust wallet its author: it comes back stamped as it went in.
 *
 *   Every transaction handed in here is stamped with the version the chain reports, which is deliberately not the floor
 *   of its epoch: a stamp equal to the floor would let a re-stamp at the floor pass for the stamp being kept.
 *
 *   None of these calls reads the wallet's state, so the wallets are never synchronized: the forking one is told by its
 *   probe which variant to start on, and the single-variant one has only the one.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import { LedgerParameters as V8LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion, type UnprovenTx, WalletTransaction } from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { Effect, Either, type Scope, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import { type DustWalletAPI } from '../DustWalletAPI.js';
import { V1Tag } from '../v1/RunningV1Variant.js';
import { dustSeed } from '../v1/test/dustEvents.js';
import { V2Tag } from '../v2/RunningV2Variant.js';
import { dustParameters as v9DustParameters } from '../v2/test/dustEvents.js';
import { type ForkWallet, makeForkWallet, makeSingleVariantWallet } from './forkHarness.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its V2 variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain that has not forked: a version the V1 variant owns, and not the floor of its epoch. */
const v8Version = ProtocolVersion.ProtocolVersion(5n);
/** A chain that has: a version the V2 variant owns, and not the boundary itself. */
const v9Version = ProtocolVersion.ProtocolVersion(9n);

const dustParameters = {
  v8: V8LedgerParameters.initialParameters().dust,
  v9: v9DustParameters(),
};

/** Never delivered: nothing here is synchronized. */
const syncTime = new Date(0);

const chainReporting =
  (version: ProtocolVersion.ProtocolVersion): ChainVersionProbe =>
  () =>
    Promise.resolve(version);

const ttl = (): Date => new Date(Date.now() + 3_600_000);

const verifyingKey = ledgerV9.signatureVerifyingKey(ledgerV9.sampleSigningKey());

const signature = ledgerV9.signData(ledgerV9.sampleSigningKey(), new Uint8Array([1, 2, 3]));

/**
 * The shape the unshielded wallet's `rotateUtxos` hands the dust wallet: one intent, with a guaranteed unshielded
 * offer, and no registration yet. Paying out and spending nothing, because nothing here checks the balance.
 */
const v8Unregistered = (): { serialize: () => Uint8Array } => {
  const intent = ledgerV8.Intent.new(ttl());
  // Mutated in place because the ledger's intents are built that way; this is test setup, not wallet code.
  intent.guaranteedUnshieldedOffer = ledgerV8.UnshieldedOffer.new(
    [],
    [{ value: 1n, owner: ledgerV9.addressFromKey(verifyingKey), type: ledgerV8.nativeToken().raw }],
    [],
  );
  return ledgerV8.Transaction.fromParts(networkId, undefined, undefined, intent);
};

const v9Unregistered = (): { serialize: () => Uint8Array } => {
  const intent = ledgerV9.Intent.new(ttl());
  // Mutated in place because the ledger's intents are built that way; this is test setup, not wallet code.
  intent.guaranteedUnshieldedOffer = ledgerV9.UnshieldedOffer.new(
    [],
    [{ value: 1n, owner: ledgerV9.addressFromKey(verifyingKey), type: ledgerV9.nativeToken().raw }],
    [],
  );
  return ledgerV9.Transaction.fromParts(networkId, undefined, undefined, intent);
};

/** The calls that hand back the transaction they were given, changed, rather than one of their own. */
type InPlaceWallet = Pick<
  DustWalletAPI,
  'attachDustRegistration' | 'addDustGenerationSignature' | 'addDustRegistrationSignature'
>;

const attach = (wallet: InPlaceWallet, transaction: UnprovenTx): Promise<UnprovenTx> =>
  wallet.attachDustRegistration(transaction, new Date(), verifyingKey, undefined, 0n);

/**
 * The same transaction, sealed at `version` instead of whatever it is stamped with.
 *
 * @remarks
 *   How a registration is put in front of the signing calls at a version of the suite's choosing. It is attached by the
 *   wallet itself — the one thing that can attach one without a chain — so what comes back is re-sealed, which keeps
 *   the stamp the signing calls are handed independent of what attaching does to it.
 */
const resealedAt = (handle: UnprovenTx, version: ProtocolVersion.ProtocolVersion): UnprovenTx =>
  WalletTransaction.adopt(
    'Unproven',
    Either.getOrThrow(
      WalletTransaction.unwrapWithin<{ serialize: () => Uint8Array }>(
        handle,
        ProtocolVersion.epochOf(handle.protocolVersion, forkVersion),
      ),
    ),
    version,
  );

const inPlaceOperations: readonly Readonly<{
  operation: string;
  call: (wallet: InPlaceWallet, unregistered: UnprovenTx) => Promise<UnprovenTx>;
}>[] = [
  { operation: 'attachDustRegistration', call: attach },
  {
    operation: 'addDustGenerationSignature',
    call: async (wallet, unregistered) =>
      wallet.addDustGenerationSignature(
        resealedAt(await attach(wallet, unregistered), unregistered.protocolVersion),
        signature,
      ),
  },
  {
    operation: 'addDustRegistrationSignature',
    call: async (wallet, unregistered) =>
      wallet.addDustRegistrationSignature(
        resealedAt(await attach(wallet, unregistered), unregistered.protocolVersion),
        signature,
      ),
  },
];

/** A forking wallet that asked the chain at `version` where to start, and was never synchronized. */
const forkingWalletAt = (version: ProtocolVersion.ProtocolVersion): Effect.Effect<ForkWallet, never, Scope.Scope> =>
  Effect.gen(function* () {
    const wallet = yield* makeForkWallet({
      v8: Stream.never,
      replayed: Effect.never,
      networkId,
      forkVersion,
      seed: dustSeed(),
      dustParameters,
      syncTime,
      chainVersionProbe: chainReporting(version),
    });
    yield* Effect.addFinalizer(() => wallet.stop);
    return wallet;
  });

/** A single-variant wallet, never synchronized. */
const singleVariantWallet: Effect.Effect<InPlaceWallet, never, Scope.Scope> = Effect.acquireRelease(
  Effect.sync(() =>
    makeSingleVariantWallet({
      replayed: Effect.never,
      networkId,
      seed: dustSeed(),
      dustParameters: dustParameters.v9,
      syncTime,
    }),
  ),
  (wallet) => Effect.promise(() => wallet.stop()),
);

describe('a forking dust wallet keeps the stamp of a transaction it changes in place', () => {
  describe.each([
    { side: 'on the V1 variant, below the boundary', version: v8Version, tag: V1Tag, unregistered: v8Unregistered },
    { side: 'on the V2 variant, from the boundary', version: v9Version, tag: V2Tag, unregistered: v9Unregistered },
  ])('$side', ({ version, tag, unregistered }) => {
    it.each(inPlaceOperations)('$operation', async ({ call }) =>
      Effect.gen(function* () {
        const wallet = yield* forkingWalletAt(version);
        expect(yield* wallet.activeTag).toBe(tag);
        const handed = WalletTransaction.adopt('Unproven', unregistered(), version);

        const answer = yield* Effect.promise(() => call(wallet.dust, handed));

        expect(answer.protocolVersion).toBe(version);
      }).pipe(Effect.scoped, Effect.runPromise),
    );
  });
});

describe('a single-variant dust wallet keeps the stamp of a transaction it changes in place', () => {
  it.each(inPlaceOperations)('$operation', async ({ call }) =>
    Effect.gen(function* () {
      const wallet = yield* singleVariantWallet;
      const handed = WalletTransaction.adopt('Unproven', v9Unregistered(), v9Version);

      const answer = yield* Effect.promise(() => call(wallet, handed));

      expect(answer.protocolVersion).toBe(v9Version);
    }).pipe(Effect.scoped, Effect.runPromise),
  );
});
