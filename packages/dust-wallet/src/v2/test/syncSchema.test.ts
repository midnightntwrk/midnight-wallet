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
import { LedgerParameters as PreForkLedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { LedgerParameters } from '@midnightntwrk/ledger-v9';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { LedgerParametersCodec } from '@midnightntwrk/wallet-sdk-capabilities/codecs';
import { Either, Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { BlockDataSchema, defaultLedgerParametersCodecs, makeBlockDataSchema } from '../SyncSchema.js';

const V9_NATIVE = ProtocolVersion.ProtocolVersion(2_000_000n);

describe('BlockDataSchema', () => {
  const ledgerParametersHex = Buffer.from(LedgerParameters.initialParameters().serialize()).toString('hex');
  const wireBlock = {
    height: 7,
    hash: '00'.repeat(32),
    protocolVersion: 2_000_000,
    ledgerParameters: ledgerParametersHex,
    timestamp: 1752487200000,
    zswapEndIndex: 3,
    dustCommitmentEndIndex: 5,
    dustGenerationEndIndex: 4,
    dustCommitmentMerkleTreeRoot: 'aa'.repeat(32),
    dustGenerationMerkleTreeRoot: 'bb'.repeat(32),
  };

  it('decodes the timestamp as UNIX milliseconds', () => {
    const decoded = Schema.decodeUnknownSync(BlockDataSchema)(wireBlock);
    expect(decoded.timestamp).toEqual(new Date(1752487200000));
  });

  it('round-trips through encode without changing the timestamp', () => {
    const decoded = Schema.decodeUnknownSync(BlockDataSchema)(wireBlock);
    const encoded = Schema.encodeSync(BlockDataSchema)(decoded);
    expect(encoded).toEqual(wireBlock);
  });

  it('decodes null merkle tree roots (block without dust state) to the empty-tree encoding', () => {
    const decoded = Schema.decodeUnknownSync(BlockDataSchema)({
      ...wireBlock,
      dustCommitmentMerkleTreeRoot: null,
      dustGenerationMerkleTreeRoot: null,
    });
    expect(decoded.dustCommitmentMerkleTreeRoot).toBe('');
    expect(decoded.dustGenerationMerkleTreeRoot).toBe('');

    const encoded = Schema.encodeSync(BlockDataSchema)(decoded);
    expect(encoded.dustCommitmentMerkleTreeRoot).toBeNull();
    expect(encoded.dustGenerationMerkleTreeRoot).toBeNull();
  });

  describe('choosing the ledger the parameters are read with', () => {
    it('reads the parameters with the codec registered for the version the block reports', () => {
      const decoded = Schema.decodeUnknownSync(BlockDataSchema)(wireBlock);

      expect(decoded.ledgerParameters).toBeInstanceOf(LedgerParameters);
    });

    it('refuses a block reported at a version this variant does not serve, instead of decoding it anyway', () => {
      // A variant bounded below the fork must disown a post-fork block rather than hand its bytes to a deserializer
      // that cannot read them — the whole batch fails today on exactly this.
      const untilFork = Either.getOrThrow(
        ProtocolVersion.makeRegistry([
          {
            range: ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, V9_NATIVE),
            value: LedgerParametersCodec.fromDeserializer((bytes: Uint8Array) => LedgerParameters.deserialize(bytes)),
          },
        ]),
      );

      const result = Schema.decodeUnknownEither(makeBlockDataSchema(untilFork))(wireBlock);

      expect(Either.isLeft(result)).toBe(true);
      expect(Option.getOrThrow(Either.getLeft(result)).message).toContain('2000000');
    });

    it('reports the other ledger version parameters as a decode failure rather than a raw WASM throw', () => {
      const preForkHex = Buffer.from(PreForkLedgerParameters.initialParameters().serialize()).toString('hex');

      const result = Schema.decodeUnknownEither(BlockDataSchema)({
        ...wireBlock,
        ledgerParameters: preForkHex,
      });

      expect(Either.isLeft(result)).toBe(true);
    });

    it('claims every protocol version by default, so a variant that has not narrowed its range still syncs', () => {
      expect(
        Option.isSome(ProtocolVersion.select(defaultLedgerParametersCodecs, ProtocolVersion.MinSupportedVersion)),
      ).toBe(true);
      expect(Either.isRight(Schema.decodeUnknownEither(BlockDataSchema)({ ...wireBlock, protocolVersion: 0 }))).toBe(
        true,
      );
    });
  });
});
