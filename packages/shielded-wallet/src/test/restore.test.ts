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
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { peekProtocolVersion, UnsupportedSnapshotVersionError, variantForSnapshot } from '../Restore.js';

/** A snapshot envelope carrying a declared protocol version, plus the fields the peek must ignore. */
const envelope = (protocolVersion: string): string =>
  JSON.stringify({
    publicKeys: { coinPublicKey: 'aa', encryptionPublicKey: 'bb' },
    state: 'deadbeef',
    protocolVersion,
    networkId: 'undeployed',
    coinHashes: {},
  });

/** The same envelope as written before snapshots declared a version at all. */
const legacyEnvelope = JSON.stringify({
  publicKeys: { coinPublicKey: 'aa', encryptionPublicKey: 'bb' },
  state: 'deadbeef',
  networkId: 'undeployed',
  coinHashes: {},
});

const preFork = { name: 'pre-fork variant' };
const postFork = { name: 'post-fork variant' };

/** Stands in for `BaseWalletClass.variantFor`: pre-fork below 100, post-fork from 100, nothing above 1000. */
const registered = (version: ProtocolVersion.ProtocolVersion): Option.Option<typeof preFork> =>
  version >= 1000n ? Option.none() : Option.some(version >= 100n ? postFork : preFork);

const neverResolves = (): Option.Option<typeof preFork> => {
  throw new Error('A snapshot that declares no version must not be routed by version');
};

describe('peekProtocolVersion', () => {
  it('reads the version a snapshot declares, ignoring every other field', () => {
    expect(peekProtocolVersion(envelope('100'))).toStrictEqual(Option.some(ProtocolVersion.ProtocolVersion(100n)));
  });

  it('reads a version from an envelope carrying nothing else', () => {
    expect(peekProtocolVersion(JSON.stringify({ protocolVersion: '7' }))).toStrictEqual(
      Option.some(ProtocolVersion.ProtocolVersion(7n)),
    );
  });

  it('finds nothing in a snapshot written before snapshots declared a version', () => {
    expect(peekProtocolVersion(legacyEnvelope)).toStrictEqual(Option.none());
  });

  it('finds nothing, rather than throwing, in something that is not a snapshot envelope at all', () => {
    expect(peekProtocolVersion('not json at all')).toStrictEqual(Option.none());
    expect(peekProtocolVersion('[]')).toStrictEqual(Option.none());
    expect(peekProtocolVersion('"a string"')).toStrictEqual(Option.none());
    expect(peekProtocolVersion('')).toStrictEqual(Option.none());
  });

  it('finds nothing when the declared version is not a version', () => {
    expect(peekProtocolVersion(JSON.stringify({ protocolVersion: 'tomorrow' }))).toStrictEqual(Option.none());
    expect(peekProtocolVersion(JSON.stringify({ protocolVersion: null }))).toStrictEqual(Option.none());
  });
});

describe('variantForSnapshot', () => {
  it('routes a snapshot to the variant that owns the version it declares', () => {
    expect(variantForSnapshot(envelope('100'), registered, preFork)).toStrictEqual(Either.right(postFork));
    expect(variantForSnapshot(envelope('99'), registered, preFork)).toStrictEqual(Either.right(preFork));
  });

  it('falls back to the head variant for a snapshot that declares no version', () => {
    expect(variantForSnapshot(legacyEnvelope, neverResolves, preFork)).toStrictEqual(Either.right(preFork));
  });

  it('falls back to the head variant for an envelope it cannot read, leaving the real error to deserialization', () => {
    expect(variantForSnapshot('not json at all', neverResolves, preFork)).toStrictEqual(Either.right(preFork));
  });

  it('reports a version no registered variant owns, naming it', () => {
    const routed = variantForSnapshot(envelope('4000'), registered, preFork);

    const error = routed.pipe(Either.flip, Either.getOrThrow);
    expect(error).toBeInstanceOf(UnsupportedSnapshotVersionError);
    expect(error._tag).toBe('@midnightntwrk/wallet-sdk-shielded/Restore/UnsupportedSnapshotVersionError');
    expect(error.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(4000n));
  });
});
