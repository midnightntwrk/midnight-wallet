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
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  NetworkId,
  ProtocolVersion,
  ProtocolVersionMismatchError,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { Either, Schema } from 'effect';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as sdk from '../index.js';
import * as v8 from '../ledger/v8.js';
import * as v9 from '../ledger/v9.js';

const PackageManifest = Schema.Struct({ exports: Schema.Record({ key: Schema.String, value: Schema.Unknown }) });

const declaredExports = Schema.decodeUnknownSync(PackageManifest)(
  // `JSON.parse` is typed `any`; widening to `unknown` is what leaves the schema as the only thing that types this.
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as unknown,
).exports;

/**
 * Names only a ledger package defines. None of them may reach an application through the umbrella package's root: an
 * application that never names a ledger version is one the fork cannot break.
 */
const ledgerOnlyNames = [
  'Transaction',
  'Intent',
  'ZswapSecretKeys',
  'DustSecretKey',
  'LedgerParameters',
  'sampleSigningKey',
  'signatureVerifyingKey',
  'nativeToken',
] as const;

describe('the ledger subpaths an author builds transactions with', () => {
  it('offers the pre-fork ledger version at ./ledger/v8', () => {
    expect(v8.Transaction).toBe(ledgerV8.Transaction);
    expect(v8.Intent).toBe(ledgerV8.Intent);
  });

  it('offers the post-fork ledger version at ./ledger/v9', () => {
    expect(v9.Transaction).toBe(ledgerV9.Transaction);
    expect(v9.Intent).toBe(ledgerV9.Intent);
  });

  it('keeps the two apart, so an author knows which one they imported', () => {
    expect(v8.Transaction).not.toBe(v9.Transaction);
  });

  it('declares both subpaths in the package exports, so they resolve by name', () => {
    expect(Object.keys(declaredExports)).toEqual(expect.arrayContaining(['./ledger/v8', './ledger/v9']));
  });

  it('never lets a ledger version out through the root, whatever the subpaths offer', () => {
    expect(Object.keys(sdk).filter((name) => (ledgerOnlyNames as readonly string[]).includes(name))).toStrictEqual([]);
  });
});

describe('a transaction an author built for itself', () => {
  const version = ProtocolVersion.ProtocolVersion(2_000_000n);

  it('can be sealed into a handle, whichever ledger version built it', () => {
    const preFork = v8.Transaction.fromParts(NetworkId.NetworkId.Undeployed);
    const postFork = v9.Transaction.fromParts(NetworkId.NetworkId.Undeployed);

    expect(WalletTransaction.adopt('Unproven', preFork, ProtocolVersion.MinSupportedVersion).serialize()).toStrictEqual(
      preFork.serialize(),
    );
    expect(WalletTransaction.adopt('Unproven', postFork, version).serialize()).toStrictEqual(postFork.serialize());
  });

  it('is refused by a caller acting on the other side of the boundary', () => {
    const postFork = v9.Transaction.fromParts(NetworkId.NetworkId.Undeployed);
    const handle = WalletTransaction.adopt('Unproven', postFork, version);
    const preForkEra = ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, version);

    const error = WalletTransaction.unwrapWithin(handle, preForkEra).pipe(Either.flip, Either.getOrThrow);

    expect(error).toBeInstanceOf(ProtocolVersionMismatchError);
    expect(error.authoredFor).toBe(version);
  });
});
