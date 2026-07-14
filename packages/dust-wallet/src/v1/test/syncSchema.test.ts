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
import { LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { BlockDataSchema } from '../SyncSchema.js';

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
