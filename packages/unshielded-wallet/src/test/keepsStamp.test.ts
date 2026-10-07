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
 * An unshielded wallet leaves alone the stamp of a transaction it changes in place.
 *
 * @remarks
 *   A stamp says which protocol version fixed a transaction's bytes. A transaction the wallet builds for itself is
 *   stamped with the floor of the epoch its variant owns. A transaction it is handed and changes in place — signs, or
 *   balances by adding its own inputs and change to — was fixed by whoever built it, and adding to it does not make the
 *   wallet its author: it comes back stamped as it went in.
 *
 *   Every transaction handed in here is stamped with the version the chain reports, which is deliberately not the floor
 *   of its epoch: a stamp equal to the floor would let a re-stamp at the floor pass for the stamp being kept.
 *
 *   Covered on both variants of the forking wallet, because each re-seals what its own ledger version returns, and on the
 *   single-variant wallet, which re-seals separately again.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  NetworkId,
  ProtocolVersion,
  type TransactionStage,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { Effect, Fiber, type Scope } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it } from 'vitest';
import { type UnshieldedWalletAPI } from '../UnshieldedWalletAPI.js';
import { V1Tag } from '../v1/RunningV1Variant.js';
import { V2Tag } from '../v2/RunningV2Variant.js';
import { type SignSegment } from '../v2/Signing.js';
import { type ForkWallet, makeForkWallet, makeSingleVariantWallet } from './forkHarness.js';
import { type TimelineItem, timelineTokenType, timelineTransaction, v2Identity } from './forkTimeline.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** Where the wallet registers its V2 variant. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
/** A chain that has not forked: a version the V1 variant owns, and not the floor of its epoch. */
const v8Version = ProtocolVersion.ProtocolVersion(5n);
/** A chain that has: a version the V2 variant owns, and not the boundary itself. */
const v9Version = ProtocolVersion.ProtocolVersion(9n);

const owner = v2Identity(networkId);

/** A chain sitting at `version`, which has paid this wallet two UTxOs of the timeline's token. */
const chainAt = (version: ProtocolVersion.ProtocolVersion): readonly TimelineItem[] => [
  timelineTransaction({ id: 1, protocolVersion: Number(version), owner: owner.addressHex, value: 100n }),
  timelineTransaction({ id: 2, protocolVersion: Number(version), owner: owner.addressHex, value: 200n }),
];

const chainReporting =
  (version: ProtocolVersion.ProtocolVersion): ChainVersionProbe =>
  () =>
    Promise.resolve(version);

const ttl = (): Date => new Date(Date.now() + 3_600_000);

const signSegment: SignSegment = (data) => Promise.resolve(ledgerV9.signData(ledgerV9.sampleSigningKey(), data));

/** What the wallet pays out in the transactions it is asked to balance, less than either UTxO it holds. */
const payout = 50n;

/** A prover that is never asked anything: neither an empty intent nor an unshielded offer has a proof to make. */
const noProofs = {
  check: () => Promise.resolve([]),
  prove: () => Promise.reject(new Error('An empty intent or an unshielded offer should have nothing to prove')),
  lookupKey: () => Promise.resolve(undefined),
};

/** A transaction as it is handed over at `stage`. */
type AtStage = (stage: TransactionStage) => Promise<{ serialize: () => Uint8Array }>;

/**
 * An unproven transaction, or the same one proved and not yet bound when it is handed over unbound — the shape a dApp
 * hands an unbound transaction over in, so the unbound calls are given a real unbound transaction to change.
 */
const atV8Stage =
  (transaction: ledgerV8.UnprovenTransaction): AtStage =>
  (stage) =>
    stage === 'Unbound'
      ? transaction.prove(noProofs, ledgerV8.LedgerParameters.initialParameters().transactionCostModel.runtimeCostModel)
      : Promise.resolve(transaction);

const atV9Stage =
  (transaction: ledgerV9.UnprovenTransaction): AtStage =>
  (stage) =>
    stage === 'Unbound'
      ? transaction.prove(noProofs, ledgerV9.LedgerParameters.initialParameters().transactionCostModel.runtimeCostModel)
      : Promise.resolve(transaction);

/** Each ledger version's own transactions to hand in, so each variant is handed bytes it can read. */
type LedgerTransactions = Readonly<{
  /** A transaction with one intent, so the signer is really asked for a signature. */
  toSign: AtStage;
  /** A transaction paying out and spending nothing, so the wallet has to add an input of its own. */
  toBalance: AtStage;
}>;

const v8Transactions: LedgerTransactions = {
  toSign: (stage) =>
    atV8Stage(ledgerV8.Transaction.fromParts(networkId, undefined, undefined, ledgerV8.Intent.new(ttl())))(stage),
  toBalance: (stage) => {
    const intent = ledgerV8.Intent.new(ttl());
    // Mutated in place because the ledger's intents are built that way; this is test setup, not wallet code.
    intent.guaranteedUnshieldedOffer = ledgerV8.UnshieldedOffer.new(
      [],
      [{ value: payout, owner: owner.addressHex, type: timelineTokenType }],
      [],
    );
    return atV8Stage(ledgerV8.Transaction.fromParts(networkId, undefined, undefined, intent))(stage);
  },
};

const v9Transactions: LedgerTransactions = {
  toSign: (stage) =>
    atV9Stage(ledgerV9.Transaction.fromParts(networkId, undefined, undefined, ledgerV9.Intent.new(ttl())))(stage),
  toBalance: (stage) => {
    const intent = ledgerV9.Intent.new(ttl());
    // Mutated in place because the ledger's intents are built that way; this is test setup, not wallet code.
    intent.guaranteedUnshieldedOffer = ledgerV9.UnshieldedOffer.new(
      [],
      [{ value: payout, owner: owner.addressHex, type: timelineTokenType }],
      [],
    );
    return atV9Stage(ledgerV9.Transaction.fromParts(networkId, undefined, undefined, intent))(stage);
  },
};

/** The calls that hand back the transaction they were given, changed, rather than one of their own. */
type InPlaceWallet = Pick<
  UnshieldedWalletAPI,
  'signUnprovenTransaction' | 'signUnboundTransaction' | 'balanceUnprovenTransaction' | 'balanceUnboundTransaction'
>;

const inPlaceOperations: readonly Readonly<{
  operation: string;
  stage: TransactionStage;
  input: keyof LedgerTransactions;
  call: (wallet: InPlaceWallet, transaction: AnyTx) => Promise<AnyTx | undefined>;
}>[] = [
  {
    operation: 'signUnprovenTransaction',
    stage: 'Unproven',
    input: 'toSign',
    call: (wallet, transaction) => wallet.signUnprovenTransaction(transaction, signSegment),
  },
  {
    operation: 'signUnboundTransaction',
    stage: 'Unbound',
    input: 'toSign',
    call: (wallet, transaction) => wallet.signUnboundTransaction(transaction, signSegment),
  },
  {
    operation: 'balanceUnprovenTransaction',
    stage: 'Unproven',
    input: 'toBalance',
    call: (wallet, transaction) => wallet.balanceUnprovenTransaction(transaction),
  },
  {
    operation: 'balanceUnboundTransaction',
    stage: 'Unbound',
    input: 'toBalance',
    call: (wallet, transaction) => wallet.balanceUnboundTransaction(transaction),
  },
];

/** A forking wallet that asked the chain at `version` where to start, and has synchronized both of its UTxOs. */
const forkingWalletAt = (version: ProtocolVersion.ProtocolVersion): Effect.Effect<ForkWallet, never, Scope.Scope> =>
  Effect.gen(function* () {
    const wallet = yield* makeForkWallet({
      timeline: chainAt(version),
      forkVersion,
      publicKey: owner,
      chainVersionProbe: chainReporting(version),
    });
    yield* Effect.addFinalizer(() => wallet.stop);
    // Subscribed before starting: the state stream does not replay, so a state reached unobserved would be missed.
    const synced = yield* Effect.fork(
      wallet.awaitState((state) => state.state.progress.appliedId === 2n).pipe(Effect.orDie),
    );
    yield* wallet.start;
    yield* Fiber.join(synced);
    return wallet;
  });

/** A single-variant wallet over the same chain, synchronized and holding both UTxOs. */
const singleVariantWalletAt = (
  version: ProtocolVersion.ProtocolVersion,
): Effect.Effect<InPlaceWallet, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const wallet = makeSingleVariantWallet({ timeline: chainAt(version), publicKey: owner, networkId });
      await wallet.start();
      await rx.firstValueFrom(wallet.state.pipe(rx.filter((state) => state.availableCoins.length === 2)));
      return wallet;
    }),
    (wallet) => Effect.promise(() => wallet.stop()),
  );

describe('a forking unshielded wallet keeps the stamp of a transaction it changes in place', () => {
  describe.each([
    { side: 'on the V1 variant, below the boundary', version: v8Version, tag: V1Tag, transactions: v8Transactions },
    { side: 'on the V2 variant, from the boundary', version: v9Version, tag: V2Tag, transactions: v9Transactions },
  ])('$side', ({ version, tag, transactions }) => {
    it.each(inPlaceOperations)('$operation', async ({ stage, input, call }) =>
      Effect.gen(function* () {
        const wallet = yield* forkingWalletAt(version);
        expect(yield* wallet.activeTag).toBe(tag);
        const handed = WalletTransaction.adopt(stage, yield* Effect.promise(() => transactions[input](stage)), version);

        const answer = yield* Effect.promise(() => call(wallet.unshielded, handed));

        // Something came back — a balancing call that answered nothing would make the stamp check below vacuous.
        expect(answer).toBeDefined();
        expect(answer?.protocolVersion).toBe(version);
      }).pipe(Effect.scoped, Effect.runPromise),
    );
  });
});

describe('a single-variant unshielded wallet keeps the stamp of a transaction it changes in place', () => {
  it.each(inPlaceOperations)('$operation', async ({ stage, input, call }) =>
    Effect.gen(function* () {
      const wallet = yield* singleVariantWalletAt(v9Version);
      const handed = WalletTransaction.adopt(
        stage,
        yield* Effect.promise(() => v9Transactions[input](stage)),
        v9Version,
      );

      const answer = yield* Effect.promise(() => call(wallet, handed));

      expect(answer).toBeDefined();
      expect(answer?.protocolVersion).toBe(v9Version);
    }).pipe(Effect.scoped, Effect.runPromise),
  );
});
