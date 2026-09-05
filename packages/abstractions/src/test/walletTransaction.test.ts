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
import { Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import * as ProtocolVersion from '../ProtocolVersion.js';
import { ProtocolVersionMismatchError, WalletTransaction, WireFormatError } from '../WalletTransaction.js';

const version = (value: bigint): ProtocolVersion.ProtocolVersion => ProtocolVersion.ProtocolVersion(value);

const range = (start: bigint, end: bigint): ProtocolVersion.ProtocolVersion.Range =>
  ProtocolVersion.makeRange(version(start), version(end));

/** Where the two ledger versions hand over, in the numbers a v9-native chain actually reports. */
const v8Version = version(1_000_000n);
const v9Version = version(2_000_000n);
const v8Epoch = range(0n, 2_000_000n);
const v9Epoch = range(2_000_000n, 3_000_000n);

/**
 * A stand-in for what either ledger version's transaction objects have in common: they serialize themselves, and
 * nothing about their type tells the wallet layer which version produced them.
 */
type LedgerLikeTransaction = Readonly<{ kind: string; serialize: () => Uint8Array }>;

const ledgerLikeTransaction = (kind: string, bytes: readonly number[]): LedgerLikeTransaction => ({
  kind,
  serialize: () => Uint8Array.from(bytes),
});

const someBytes = [0xde, 0xad, 0xbe, 0xef] as const;
const someTransaction = (): LedgerLikeTransaction => ledgerLikeTransaction('v9-finalized', someBytes);

describe('WalletTransaction', () => {
  describe('adopt', () => {
    it('seals a transaction with the stage and the protocol version it was built at', () => {
      const handle = WalletTransaction.adopt('Finalized', someTransaction(), v9Version);

      expect(handle.stage).toBe('Finalized');
      expect(handle.protocolVersion).toBe(v9Version);
    });

    it('does not expose the transaction it carries', () => {
      const transaction = someTransaction();
      const handle = WalletTransaction.adopt('Finalized', transaction, v9Version);

      expect(Object.keys(handle)).toStrictEqual(['protocolVersion', 'stage']);
      expect(Object.values(handle)).not.toContain(transaction);
      // @ts-expect-error the carried transaction is unreachable through the handle, which is the point of it
      expect(handle.transaction).toBeUndefined();
    });

    it('serializes as the transaction it carries does', () => {
      const handle = WalletTransaction.adopt('Unproven', someTransaction(), v8Version);

      expect(handle.serialize()).toStrictEqual(Uint8Array.from(someBytes));
    });
  });

  describe('unwrapWithin', () => {
    it('hands the transaction over when the stamp lies in the range the caller acts at', () => {
      const transaction = someTransaction();
      const handle = WalletTransaction.adopt('Finalized', transaction, v9Version);

      expect(WalletTransaction.unwrapWithin<LedgerLikeTransaction>(handle, v9Epoch)).toStrictEqual(
        Either.right(transaction),
      );
    });

    it('refuses a ledger-v8 transaction handed to a ledger-v9 caller, naming both', () => {
      const handle = WalletTransaction.adopt('Finalized', someTransaction(), v8Version);

      const error = WalletTransaction.unwrapWithin(handle, v9Epoch).pipe(Either.flip, Either.getOrThrow);

      expect(error).toBeInstanceOf(ProtocolVersionMismatchError);
      expect(error._tag).toBe('@midnightntwrk/wallet-sdk-abstractions/WalletTransaction/ProtocolVersionMismatchError');
      expect(error.authoredFor).toBe(v8Version);
      expect(error.accepted).toStrictEqual(v9Epoch);
      expect(error.stage).toBe('Finalized');
    });

    it('refuses a ledger-v9 transaction handed to a ledger-v8 caller, naming both', () => {
      const handle = WalletTransaction.adopt('Unproven', someTransaction(), v9Version);

      const error = WalletTransaction.unwrapWithin(handle, v8Epoch).pipe(Either.flip, Either.getOrThrow);

      expect(error.authoredFor).toBe(v9Version);
      expect(error.accepted).toStrictEqual(v8Epoch);
      expect(error.stage).toBe('Unproven');
    });
  });

  describe('atStage', () => {
    it('narrows a handle to the stage it is at', () => {
      const handle = WalletTransaction.adopt('Unbound', someTransaction(), v9Version);

      expect(WalletTransaction.atStage(handle, 'Unbound')).toStrictEqual(Option.some(handle));
    });

    it('answers nothing for a stage the handle is not at', () => {
      const handle = WalletTransaction.adopt('Unbound', someTransaction(), v9Version);

      expect(WalletTransaction.atStage(handle, 'Finalized')).toStrictEqual(Option.none());
    });
  });

  describe('is', () => {
    it('recognises a handle', () => {
      expect(WalletTransaction.is(WalletTransaction.adopt('Finalized', someTransaction(), v9Version))).toBe(true);
    });

    it('rejects an object that merely looks like one', () => {
      const lookalike = { protocolVersion: v9Version, stage: 'Finalized', serialize: () => Uint8Array.from(someBytes) };

      expect(WalletTransaction.is(lookalike)).toBe(false);
    });

    it('rejects values that are not objects at all', () => {
      expect(WalletTransaction.is(undefined)).toBe(false);
      expect(WalletTransaction.is('Finalized')).toBe(false);
    });
  });

  describe('toWire', () => {
    it('writes an envelope naming its own format, the protocol version, the stage and the bytes', () => {
      const handle = WalletTransaction.adopt('Finalized', someTransaction(), v9Version);

      expect(WalletTransaction.toWire(handle)).toStrictEqual({
        wireFormat: 1,
        protocolVersion: '2000000',
        stage: 'Finalized',
        transaction: 'deadbeef',
      });
    });
  });

  describe('fromWire', () => {
    /** A decoder that reports back, in the transaction it produces, exactly what the envelope handed it. */
    const decodeEchoing = (
      bytes: Uint8Array,
      protocolVersion: ProtocolVersion.ProtocolVersion,
      stage: WalletTransaction.Stage,
    ): LedgerLikeTransaction => ledgerLikeTransaction(`${stage}@${protocolVersion}`, Array.from(bytes));

    it('reads the envelope back into a handle, decoding at the version the envelope names', () => {
      const wire = WalletTransaction.toWire(WalletTransaction.adopt('Finalized', someTransaction(), v9Version));

      const handle = WalletTransaction.fromWire(wire, decodeEchoing).pipe(Either.getOrThrow);

      expect(handle.protocolVersion).toBe(v9Version);
      expect(handle.stage).toBe('Finalized');
      const decoded = WalletTransaction.unwrapWithin<LedgerLikeTransaction>(handle, v9Epoch).pipe(Either.getOrThrow);
      expect(decoded.kind).toBe('Finalized@2000000');
      expect(decoded.serialize()).toStrictEqual(Uint8Array.from(someBytes));
    });

    it('round-trips the bytes the handle carried', () => {
      const wire = WalletTransaction.toWire(WalletTransaction.adopt('Unproven', someTransaction(), v8Version));

      const handle = WalletTransaction.fromWire(wire, decodeEchoing).pipe(Either.getOrThrow);

      expect(handle.serialize()).toStrictEqual(Uint8Array.from(someBytes));
    });

    it('refuses an envelope of a wire format it does not know', () => {
      const wire = { ...WalletTransaction.toWire(WalletTransaction.adopt('Unproven', someTransaction(), v8Version)) };

      const error = WalletTransaction.fromWire({ ...wire, wireFormat: 2 }, decodeEchoing).pipe(
        Either.flip,
        Either.getOrThrow,
      );

      expect(error).toBeInstanceOf(WireFormatError);
      expect(error._tag).toBe('@midnightntwrk/wallet-sdk-abstractions/WalletTransaction/WireFormatError');
    });

    it('refuses an envelope that is missing a field', () => {
      const error = WalletTransaction.fromWire(
        { wireFormat: 1, protocolVersion: '2000000', stage: 'Finalized' },
        decodeEchoing,
      ).pipe(Either.flip, Either.getOrThrow);

      expect(error).toBeInstanceOf(WireFormatError);
    });

    it('refuses an envelope naming a stage that is not one', () => {
      const error = WalletTransaction.fromWire(
        { wireFormat: 1, protocolVersion: '2000000', stage: 'Proven', transaction: 'deadbeef' },
        decodeEchoing,
      ).pipe(Either.flip, Either.getOrThrow);

      expect(error).toBeInstanceOf(WireFormatError);
    });

    it('refuses anything that is not an envelope at all', () => {
      expect(Either.isLeft(WalletTransaction.fromWire('deadbeef', decodeEchoing))).toBe(true);
    });

    it('carries out a decoder that throws as a wire failure rather than letting it escape', () => {
      const wire = WalletTransaction.toWire(WalletTransaction.adopt('Finalized', someTransaction(), v9Version));
      const cause = new Error('these bytes are not of this ledger version');

      const error = WalletTransaction.fromWire(wire, () => {
        throw cause;
      }).pipe(Either.flip, Either.getOrThrow);

      expect(error).toBeInstanceOf(WireFormatError);
      expect(error.cause).toBe(cause);
    });
  });
});
