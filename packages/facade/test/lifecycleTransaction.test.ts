/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as ledgerV8 from '@midnightntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion, WalletTransaction } from '@midnightntwrk/wallet-sdk-abstractions';
import { Lifecycle, TransactionTraits } from '@midnightntwrk/wallet-sdk-capabilities/transactionLifecycle';
import { DateTime, Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { type LifecycleEntry, lifecycleEntriesOf } from '../src/index.js';
import { erasedOf, type LifecycleTx, lifecycleTransactionTraits, lifecycleTxOf } from '../src/transaction.js';

const FORK = ProtocolVersion.V9NativeForkVersion;
const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const TTL = new Date('2030-01-01T01:00:00.000Z');
const CREATED_AT = DateTime.unsafeMake('2030-01-01T00:00:00.000Z');

const traits = lifecycleTransactionTraits(FORK);

/** The parts of a ledger transaction this file reads, the same on both ledgers. */
type Balanced = {
  identifiers(): string[];
  serialize(): Uint8Array;
  eraseProofs(): { serialize(): Uint8Array };
  readonly intents: ReadonlyMap<number, { readonly ttl: Date; intentHash(segment: number): string }> | undefined;
};

/** An unproven transaction spending one unshielded coin, built on ledger-v8. */
const v8Balanced = (spentFrom: string): ledgerV8.UnprovenTransaction => {
  const intent = ledgerV8.Intent.new(TTL);
  intent.fallibleUnshieldedOffer = ledgerV8.UnshieldedOffer.new(
    [
      {
        value: 1n,
        owner: ledgerV8.signatureVerifyingKey(ledgerV8.sampleSigningKey()),
        type: ledgerV8.nativeToken().raw,
        intentHash: spentFrom,
        outputNo: 0,
      },
    ],
    [{ value: 1n, owner: ledgerV8.sampleUserAddress(), type: ledgerV8.nativeToken().raw }],
    [],
  );
  return ledgerV8.Transaction.fromParts(NETWORK_ID, undefined, undefined, intent);
};

/** The same transaction, built on ledger-v9. */
const v9Balanced = (spentFrom: string): ledgerV9.UnprovenTransaction => {
  const intent = ledgerV9.Intent.new(TTL);
  intent.fallibleUnshieldedOffer = ledgerV9.UnshieldedOffer.new(
    [
      {
        value: 1n,
        owner: ledgerV9.signatureVerifyingKey(ledgerV9.sampleSigningKey()),
        type: ledgerV9.nativeToken().raw,
        intentHash: spentFrom,
        outputNo: 0,
      },
    ],
    [{ value: 1n, owner: ledgerV9.sampleUserAddress(), type: ledgerV9.nativeToken().raw }],
    [],
  );
  return ledgerV9.Transaction.fromParts(NETWORK_ID, undefined, undefined, intent);
};

const LEDGERS = [
  {
    ledger: 'ledger-v8',
    version: ProtocolVersion.MinSupportedVersion,
    epochStart: ProtocolVersion.MinSupportedVersion,
    spentFrom: ledgerV8.sampleIntentHash(),
    build: (spentFrom: string): Balanced => v8Balanced(spentFrom),
  },
  {
    ledger: 'ledger-v9',
    version: ProtocolVersion.ProtocolVersion(FORK + 1n),
    epochStart: FORK,
    spentFrom: ledgerV9.sampleIntentHash(),
    build: (spentFrom: string): Balanced => v9Balanced(spentFrom),
  },
] as const;

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const traitFor = (version: ProtocolVersion.ProtocolVersion) =>
  Option.getOrThrow(TransactionTraits.traitForVersion(traits, Option.some(version)));

describe.each(LEDGERS)(
  'A $ledger transaction held by its lifecycle record',
  ({ version, epochStart, spentFrom, build }) => {
    const balanced = build(spentFrom);
    const handle = WalletTransaction.adopt('Unproven', balanced, version);

    it('should hold a balanced transaction with its proofs erased, stamped with the version it was built for', () => {
      const held = erasedOf(handle, FORK);

      expect(held.protocolVersion).toBe(version);
      expect(held.form).toBe('Erased');
      expect(hex(traitFor(version).serialize(held))).toBe(hex(balanced.eraseProofs().serialize()));
    });

    it('should read the identifiers, intent hashes, inputs and TTL off the erased form that the balanced one carries', () => {
      const trait = traitFor(version);
      const held = erasedOf(handle, FORK);

      expect(trait.ids(held)).toStrictEqual(balanced.identifiers());
      expect(trait.firstId(held)).toBe(balanced.identifiers()[0]);
      expect(trait.intentHashes(held)).toStrictEqual(
        [...(balanced.intents?.entries() ?? [])].map(([segment, intent]) => intent.intentHash(segment)),
      );
      expect(trait.inputs(held)).toStrictEqual({ unshielded: [`${spentFrom}#0`] });
      expect(trait.ttl(held, CREATED_AT)).toStrictEqual(balanced.intents?.get(1)?.ttl);
    });

    // A simulated prover finalizes by erasing proofs, so bytes without proofs can be a finalized transaction: the form
    // the record held is stored beside the bytes and wins over what the bytes would suggest.
    it('should name the form it holds, and read erased bytes stored as finalized back as finalized', () => {
      const trait = traitFor(version);
      const finalizedWithoutProofs = { ...erasedOf(handle, FORK), form: 'Finalized' as const };

      expect(trait.formOf?.(erasedOf(handle, FORK))).toBe('Erased');
      expect(trait.formOf?.(finalizedWithoutProofs)).toBe('Finalized');
      expect(trait.deserialize(trait.serialize(finalizedWithoutProofs), 'Finalized').form).toBe('Finalized');
    });

    it('should read back the erased bytes it wrote, stamped with the first version of their epoch', () => {
      const trait = traitFor(version);
      const written = trait.serialize(erasedOf(handle, FORK));

      const read = Either.try(() => trait.deserialize(written));

      expect(Either.isRight(read)).toBe(true);
      if (Either.isRight(read)) {
        expect(read.right.protocolVersion).toBe(epochStart);
        expect(read.right.form).toBe('Erased');
        expect(trait.isTx(read.right)).toBe(true);
        expect(hex(trait.serialize(read.right))).toBe(hex(written));
      }
    });

    it('should hold a finalized handle’s transaction as the handle carries it', () => {
      const erased = balanced.eraseProofs();
      const finalized = WalletTransaction.adopt('Finalized', erased, version);

      const held = lifecycleTxOf(finalized, FORK);

      expect(held.protocolVersion).toBe(version);
      expect(held.transaction).toBe(erased);
      expect(held.form).toBe('Finalized');
    });

    // The store an application keeps and hands back is written and read with these traits, so the records the facade
    // makes must come back from it as the entries they were.
    it('should read back a stored store of the records the facade makes, as the entries they were', () => {
      const balancedTx = erasedOf(handle, FORK);
      const finalizedTx = lifecycleTxOf(WalletTransaction.adopt('Finalized', balanced.eraseProofs(), version), FORK);
      const recordOf = (
        held: LifecycleTx,
        state: Lifecycle.LifecycleState,
      ): Lifecycle.LifecycleRecord<LifecycleTx> => ({
        identifiers: balanced.identifiers(),
        intentHashes: traitFor(version).intentHashes(held),
        inputs: traitFor(version).inputs(held),
        ttl: TTL,
        protocolVersion: Option.some(version),
        tx: Option.some(held),
        createdAt: CREATED_AT,
        submittedAt: Option.none(),
        state,
      });
      const stored: Lifecycle.TransactionLifecycle<LifecycleTx> = {
        records: [
          recordOf(balancedTx, Lifecycle.LifecycleState.Balanced()),
          recordOf(balancedTx, Lifecycle.LifecycleState.Expired()),
          recordOf(finalizedTx, Lifecycle.LifecycleState.Finalized()),
          recordOf(finalizedTx, Lifecycle.LifecycleState.Submitted()),
        ],
      };
      const entryShape = (entries: readonly LifecycleEntry[]) =>
        entries.map((entry) => ({
          status: entry.status._tag,
          identifiers: entry.identifiers,
          authoredFor: entry.authoredFor,
          transaction: Option.map(entry.transaction, (tx) => [tx.stage, tx.protocolVersion]),
        }));

      const restored = Lifecycle.deserialize(Lifecycle.serialize(stored, traits), traits);

      expect(Either.map(restored, (lifecycle) => entryShape(lifecycleEntriesOf(lifecycle)))).toStrictEqual(
        Either.right(entryShape(lifecycleEntriesOf(stored))),
      );
      expect(entryShape(lifecycleEntriesOf(stored)).map((entry) => entry.transaction)).toStrictEqual([
        Option.none(),
        Option.none(),
        Option.some(['Finalized', version]),
        Option.some(['Finalized', version]),
      ]);
    });
  },
);

describe('The lifecycle traits on either side of the fork', () => {
  const [v8, v9] = LEDGERS;
  const heldV8: LifecycleTx = erasedOf(WalletTransaction.adopt('Unproven', v8.build(v8.spentFrom), v8.version), FORK);
  const heldV9: LifecycleTx = erasedOf(WalletTransaction.adopt('Unproven', v9.build(v9.spentFrom), v9.version), FORK);

  it('should each recognise only its own ledger’s transaction, so neither reads bytes the other ledger wrote', () => {
    expect([traitFor(v8.version).isTx(heldV8), traitFor(v8.version).isTx(heldV9)]).toStrictEqual([true, false]);
    expect([traitFor(v9.version).isTx(heldV9), traitFor(v9.version).isTx(heldV8)]).toStrictEqual([true, false]);
  });
});
