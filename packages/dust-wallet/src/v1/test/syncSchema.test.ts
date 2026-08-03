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
import { LedgerParameters } from '@midnightntwrk/ledger-v9';
import { Either, ParseResult, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { BlockDataSchema, CollapsedMerkleTreeSchema, DustGenerationDtimeUpdateItemSchema } from '../SyncSchema.js';

describe('BlockDataSchema', () => {
  const ledgerParametersHex = Buffer.from(LedgerParameters.initialParameters().serialize()).toString('hex');
  const wireBlock = {
    height: 7,
    hash: '00'.repeat(32),
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
});

// The two merkle decoders wrap a throwing ledger deserializer in Effect.try. Their success paths cannot be
// reached from a unit test — building a real collapsed update or insertion path needs a populated global dust
// tree, and the ledger rejects every range against a fresh DustState ("attempted update on updated sub-tree").
// What these tests pin is the failure contract: a bad wire value must surface as a schema ParseError that the
// caller can handle, never as a thrown ledger exception escaping the decode, and the two layers must stay
// distinguishable so a malformed payload is not mistaken for a malformed hex string.
describe('merkle decoders reject malformed wire values', () => {
  const wireCollapsedUpdate = (update: string) => ({
    startIndex: 0,
    endIndex: 4095,
    update,
    protocolVersion: 1,
  });

  const wireDtimeUpdate = (treeInsertionPath: string) => ({
    __typename: 'DustGenerationDtimeUpdateItem',
    generationMtIndex: 3,
    nightUtxoHash: 'aa'.repeat(32),
    newDtime: 1752487200,
    treeInsertionPath,
  });

  const failureTree = (input: unknown, schema: typeof CollapsedMerkleTreeSchema) => {
    const result = Schema.decodeUnknownEither(schema)(input);
    if (Either.isRight(result)) {
      throw new Error('expected the decode to fail');
    }
    expect(ParseResult.isParseError(result.left)).toBe(true);
    return ParseResult.TreeFormatter.formatErrorSync(result.left);
  };

  it('surfaces a collapsed-update deserialization failure as a type-side ParseError', () => {
    const tree = failureTree(wireCollapsedUpdate('00'.repeat(8)), CollapsedMerkleTreeSchema);
    expect(tree).toContain('DustStateMerkleTreeCollapsedUpdate');
    // The hex parsed, so the failure belongs to the bytes-to-ledger step, not to the hex step.
    expect(tree).toContain('Type side transformation failure');
  });

  it('distinguishes a malformed hex string from a malformed collapsed-update payload', () => {
    const tree = failureTree(wireCollapsedUpdate('zz'), CollapsedMerkleTreeSchema);
    expect(tree).toContain('Encoded side transformation failure');
    expect(tree).not.toContain('Type side transformation failure');
  });

  it('surfaces an insertion-path deserialization failure as a ParseError', () => {
    const result = Schema.decodeUnknownEither(DustGenerationDtimeUpdateItemSchema)(wireDtimeUpdate('00'.repeat(8)));
    if (Either.isRight(result)) {
      throw new Error('expected the decode to fail');
    }
    expect(ParseResult.isParseError(result.left)).toBe(true);
    expect(ParseResult.TreeFormatter.formatErrorSync(result.left)).toContain('DustGenerationTreeInsertionPath');
  });
});
