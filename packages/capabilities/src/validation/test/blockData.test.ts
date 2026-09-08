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
import { LedgerParameters as V8LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { LedgerParameters } from '@midnightntwrk/ledger-v9';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Buffer } from 'buffer';
import { Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { LedgerParametersCodec } from '../../codecs/index.js';
import { blockDataFrom, defaultLedgerParametersCodecs } from '../blockData.js';

const V9_NATIVE = ProtocolVersion.ProtocolVersion(2_000_000n);

const blockAt = (protocolVersion: number, ledgerParameters: string) => ({
  hash: '00'.repeat(32),
  height: 7,
  protocolVersion,
  ledgerParameters,
  timestamp: 1752487200000,
});

describe('Reading a block the indexer served', () => {
  const hex = Buffer.from(LedgerParameters.initialParameters().serialize()).toString('hex');
  const v8Hex = Buffer.from(V8LedgerParameters.initialParameters().serialize()).toString('hex');
  const codecs = defaultLedgerParametersCodecs(V9_NATIVE);

  it('reads the parameters with the codec registered for the version the block reports', () => {
    const result = blockDataFrom(codecs, blockAt(2_000_000, hex));

    expect(Either.isRight(result)).toBe(true);
    const blockData = Option.getOrThrow(Either.getRight(result));
    expect(blockData.ledgerParameters).toBeInstanceOf(LedgerParameters);
    expect(blockData.protocolVersion).toBe(2_000_000);
    expect(blockData.timestamp).toEqual(new Date(1752487200000));
  });

  it('reads a block from before the v9 fork with the ledger-v8, and says so by its class', () => {
    // The two ledger versions' `LedgerParameters` are structurally identical, so nothing in the type says which one
    // came back — the class does, and it is the class the ledger's own `wellFormed` insists on.
    const result = blockDataFrom(codecs, blockAt(1, v8Hex));

    expect(Either.isRight(result)).toBe(true);
    const blockData = Option.getOrThrow(Either.getRight(result));
    expect(blockData.ledgerParameters).toBeInstanceOf(V8LedgerParameters);
    expect(blockData.ledgerParameters).not.toBeInstanceOf(LedgerParameters);
  });

  it('splits at the fork version exactly, so the boundary block is already ledger-v9', () => {
    const atBoundary = Option.getOrThrow(Either.getRight(blockDataFrom(codecs, blockAt(2_000_000, hex))));
    const belowBoundary = Option.getOrThrow(Either.getRight(blockDataFrom(codecs, blockAt(1_999_999, v8Hex))));

    expect(atBoundary.ledgerParameters).toBeInstanceOf(LedgerParameters);
    expect(belowBoundary.ledgerParameters).toBeInstanceOf(V8LedgerParameters);
  });

  it('reads every block with ledger-v9 when the chain has no boundary below it', () => {
    // A chain whose fork version is the minimum supported one has no ledger-v8 epoch at all, so registering a codec
    // for one would claim a range that cannot occur.
    const noV8 = defaultLedgerParametersCodecs(ProtocolVersion.MinSupportedVersion);

    const blockData = Option.getOrThrow(Either.getRight(blockDataFrom(noV8, blockAt(0, hex))));

    expect(blockData.ledgerParameters).toBeInstanceOf(LedgerParameters);
  });

  it('refuses a block reported at a version the caller does not validate for, naming that version', () => {
    const untilFork = Either.getOrThrow(
      ProtocolVersion.makeRegistry([
        {
          range: ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, V9_NATIVE),
          value: LedgerParametersCodec.fromDeserializer((bytes: Uint8Array) => LedgerParameters.deserialize(bytes)),
        },
      ]),
    );

    const error = Option.getOrThrow(Either.getLeft(blockDataFrom(untilFork, blockAt(2_000_000, hex))));

    expect(error).toBeInstanceOf(LedgerParametersCodec.UnsupportedProtocolVersionError);
    expect(error.protocolVersion).toStrictEqual(V9_NATIVE);
  });

  it('reports the other ledger version parameters as a typed decode failure', () => {
    // A block reported from after the boundary, carrying bytes from before it: the version says which codec to use,
    // and that codec cannot read them. Nothing else can tell the two apart, which is why this is a decode failure and
    // not a mis-read.
    const error = Option.getOrThrow(Either.getLeft(blockDataFrom(codecs, blockAt(2_000_000, v8Hex))));

    expect(error).toBeInstanceOf(LedgerParametersCodec.LedgerParametersDecodeError);
  });
});
