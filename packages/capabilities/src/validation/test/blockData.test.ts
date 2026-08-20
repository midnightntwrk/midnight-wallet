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

  it('reads the parameters with the codec registered for the version the block reports', () => {
    const result = blockDataFrom(defaultLedgerParametersCodecs, blockAt(2_000_000, hex));

    expect(Either.isRight(result)).toBe(true);
    const blockData = Option.getOrThrow(Either.getRight(result));
    expect(blockData.ledgerParameters).toBeInstanceOf(LedgerParameters);
    expect(blockData.protocolVersion).toBe(2_000_000);
    expect(blockData.timestamp).toEqual(new Date(1752487200000));
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
    const preForkHex = Buffer.from(PreForkLedgerParameters.initialParameters().serialize()).toString('hex');

    const error = Option.getOrThrow(
      Either.getLeft(blockDataFrom(defaultLedgerParametersCodecs, blockAt(0, preForkHex))),
    );

    expect(error).toBeInstanceOf(LedgerParametersCodec.LedgerParametersDecodeError);
  });
});
