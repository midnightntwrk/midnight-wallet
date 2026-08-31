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
import * as PreForkSignatures from '@midnightntwrk/wallet-sdk-capabilities/signatures';
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

  it('offers, through the root alone, everything an application needs that is not authoring', () => {
    // The names an application would otherwise reach for a ledger package to get. Every one of them is here, and
    // none of them loads either ledger's WebAssembly — which together is what lets an application drop the ledger
    // dependency from its own manifest.
    for (const name of [
      // Keys and start, which is where an application used to need `ZswapSecretKeys` and `DustSecretKey`.
      'WalletSeeds',
      'HDWallet',
      'Roles',
      // Tokens, which is where it used to need `nativeToken`.
      'Token',
      'parseTokenType',
      // The transactions it carries, which is where it used to name `Transaction` and its stages.
      'WalletTransaction',
      'ProtocolVersionMismatchError',
      // Where the chain is, and whether the wallets agree about it.
      'ProtocolVersion',
      'protocolPhaseOf',
      // Signing, which is the one scalar whose shape genuinely changed at the boundary.
      'Signing',
      'UnsupportedSignatureKindError',
    ]) {
      expect(Object.keys(sdk)).toContain(name);
    }
  });

  it('promotes the signing error rather than restating it, so a caught error is the one the SDK threw', () => {
    expect(sdk.UnsupportedSignatureKindError).toBe(PreForkSignatures.UnsupportedSignatureKindError);
  });
});

describe('the signature shape the SDK speaks', () => {
  it('is the current ledger version shape, so a signer already written against it compiles unchanged', () => {
    const signature: ledgerV9.Signature = { tag: 'schnorr', value: 'aa' };
    const asSdk: sdk.Signing.Signature = signature;
    const backAgain: ledgerV9.Signature = { ...asSdk };

    expect(backAgain).toStrictEqual(signature);
  });

  it('lifts what the pre-fork ledger version writes as bare hexadecimal', () => {
    // The pre-fork ledger has exactly one scheme, so naming it is never a guess — which is why lifting is total and
    // lowering is not.
    const lifted: sdk.Signing.Signature = PreForkSignatures.liftSignature('aa');

    expect(lifted).toStrictEqual({ tag: 'schnorr', value: 'aa' });
    expect(Either.getOrThrow(PreForkSignatures.lowerSignature(lifted))).toBe('aa');
  });

  it('refuses to lower a scheme the pre-fork ledger version has never heard of', () => {
    const error = PreForkSignatures.lowerSignature({ tag: 'ecdsa', value: 'aa' }).pipe(Either.flip, Either.getOrThrow);

    expect(error).toBeInstanceOf(sdk.UnsupportedSignatureKindError);
    expect(error.kind).toBe('ecdsa');
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
