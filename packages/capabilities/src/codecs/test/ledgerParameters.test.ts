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
import { LedgerParameters as LedgerParametersV8 } from '@midnight-ntwrk/ledger-v8';
import { LedgerParameters as LedgerParametersV9 } from '@midnightntwrk/ledger-v9';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Buffer } from 'buffer';
import { Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { LedgerParametersCodec } from '../index.js';

const version = (value: bigint): ProtocolVersion.ProtocolVersion => ProtocolVersion.ProtocolVersion(value);

const FORK = version(2_000_000n);

/** A codec that reports which era decoded the hex, so selection is observable without going near a ledger. */
const labelled = (label: string): LedgerParametersCodec.LedgerParametersCodec<string> => ({
  decode: (hex) => `${label}:${hex}`,
});

const exploding = (message: string): LedgerParametersCodec.LedgerParametersCodec<string> => ({
  decode: () => {
    throw new Error(message);
  },
});

type Activation<T> = Readonly<{
  sinceVersion: ProtocolVersion.ProtocolVersion;
  codec: LedgerParametersCodec.LedgerParametersCodec<T>;
}>;

const codecsOf = <T>(...activations: readonly Activation<T>[]): LedgerParametersCodec.LedgerParametersCodecs<T> =>
  Either.getOrThrow(
    ProtocolVersion.makeRegistryFromActivations(
      activations.map(({ sinceVersion, codec }) => ({ sinceVersion, value: codec })),
    ),
  );

/** The shape a variant's own registry has: one codec, bounded by the range that variant is active over. */
const codecOver = <T>(
  range: ProtocolVersion.ProtocolVersion.Range,
  codec: LedgerParametersCodec.LedgerParametersCodec<T>,
): LedgerParametersCodec.LedgerParametersCodecs<T> =>
  Either.getOrThrow(ProtocolVersion.makeRegistry([{ range, value: codec }]));

const failureOf = <A, E>(result: Either.Either<A, E>): E => Option.getOrThrow(Either.getLeft(result));

describe('Ledger parameters codec registry', () => {
  it('decodes with the codec whose range covers the version the block was reported under', () => {
    const codecs = codecsOf(
      { sinceVersion: ProtocolVersion.MinSupportedVersion, codec: labelled('v8') },
      { sinceVersion: FORK, codec: labelled('v9') },
    );

    expect(LedgerParametersCodec.decode(codecs, version(0n), 'aa')).toStrictEqual(Either.right('v8:aa'));
    expect(LedgerParametersCodec.decode(codecs, version(1_999_999n), 'aa')).toStrictEqual(Either.right('v8:aa'));
    expect(LedgerParametersCodec.decode(codecs, FORK, 'aa')).toStrictEqual(Either.right('v9:aa'));
  });

  it('refuses a version no codec covers, naming the version rather than guessing a ledger', () => {
    const codecs = codecsOf({ sinceVersion: FORK, codec: labelled('v9') });

    const error = failureOf(LedgerParametersCodec.decode(codecs, version(17n), 'aa'));

    expect(error).toBeInstanceOf(LedgerParametersCodec.UnsupportedProtocolVersionError);
    expect(error.protocolVersion).toStrictEqual(version(17n));
  });

  it('turns a codec throwing into a typed decode failure that names the version it was asked for', () => {
    const codecs = codecsOf({ sinceVersion: ProtocolVersion.MinSupportedVersion, codec: exploding('bad header tag') });

    const error = failureOf(LedgerParametersCodec.decode(codecs, version(5n), 'aa'));

    expect(error).toBeInstanceOf(LedgerParametersCodec.LedgerParametersDecodeError);
    expect(error.protocolVersion).toStrictEqual(version(5n));
  });

  describe('over the two shipped ledgers', () => {
    const v8Hex = Buffer.from(LedgerParametersV8.initialParameters().serialize()).toString('hex');
    const v9Hex = Buffer.from(LedgerParametersV9.initialParameters().serialize()).toString('hex');

    const v8Codec = LedgerParametersCodec.fromDeserializer((bytes: Uint8Array) => LedgerParametersV8.deserialize(bytes));
    const v9Codec = LedgerParametersCodec.fromDeserializer((bytes: Uint8Array) => LedgerParametersV9.deserialize(bytes));

    it('decodes each ledger version through a registry that only claims that version', () => {
      const preFork = codecOver(ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, FORK), v8Codec);
      const postFork = codecsOf({ sinceVersion: FORK, codec: v9Codec });

      expect(Either.isRight(LedgerParametersCodec.decode(preFork, version(1n), v8Hex))).toBe(true);
      expect(Either.isRight(LedgerParametersCodec.decode(postFork, FORK, v9Hex))).toBe(true);
    });

    it('keeps a variant away from the other ledger version bytes entirely, rather than deserializing them', () => {
      // This is the whole point of routing the decode: a pre-fork variant that meets a post-fork block is told "not
      // mine" by selection, so the other ledger version's bytes never reach a deserializer that would reject them —
      // the same failure mode the shielded event path had to stop producing.
      const preFork = codecOver(ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, FORK), v8Codec);

      const error = failureOf(LedgerParametersCodec.decode(preFork, FORK, v9Hex));

      expect(error).toBeInstanceOf(LedgerParametersCodec.UnsupportedProtocolVersionError);
    });

    it('reports the other ledger version bytes as a decode failure when selection did let them through', () => {
      // Selection cannot always be narrow enough — a registry with one entry covering everything, or an indexer that
      // misreports, still hands the wrong bytes over. That has to be a typed failure, not a raw WASM throw.
      const everything = codecsOf({ sinceVersion: ProtocolVersion.MinSupportedVersion, codec: v8Codec });

      const error = failureOf(LedgerParametersCodec.decode(everything, version(1n), v9Hex));

      expect(error).toBeInstanceOf(LedgerParametersCodec.LedgerParametersDecodeError);
    });
  });
});
