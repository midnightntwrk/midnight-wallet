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
import { ProtocolVersion, type SnapshotFormat } from '@midnightntwrk/wallet-sdk-abstractions';
import { Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { peekProtocolVersion, peekWriter, UnsupportedSnapshotVersionError, variantForSnapshot } from '../Restore.js';

/** A snapshot envelope carrying a declared protocol version, plus the fields the peek must ignore. */
const envelope = (protocolVersion: string, writtenBy?: SnapshotFormat.SnapshotWriter): string =>
  JSON.stringify({
    ...(writtenBy === undefined ? {} : { writtenBy }),
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

const v1 = { name: 'V1 variant' };
const v2 = { name: 'V2 variant' };

/** Stands in for `BaseWalletClass.variantFor`: ledger-v8 below 100, ledger-v9 from 100, nothing above 1000. */
const registered = (version: ProtocolVersion.ProtocolVersion): Option.Option<typeof v1> =>
  version >= 1000n ? Option.none() : Option.some(version >= 100n ? v2 : v1);

const neverResolves = (): Option.Option<typeof v1> => {
  throw new Error('A snapshot that declares no version must not be routed by version');
};

/** Stands in for `BaseWalletClass.variantWrittenBy` in a build registering both variants. */
const registeredWriter = (writer: SnapshotFormat.SnapshotWriter): Option.Option<typeof v1> =>
  Option.some(writer === 'v1' ? v1 : v2);

/** The same, in a build that registers only the V2 variant. */
const onlyV2Registered = (writer: SnapshotFormat.SnapshotWriter): Option.Option<typeof v1> =>
  writer === 'v2' ? Option.some(v2) : Option.none();

const neverResolvesWriter = (): Option.Option<typeof v1> => {
  throw new Error('A snapshot that names no writer must not be routed by writer');
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

  it('still reads the version when the snapshot names a writer it does not know', () => {
    expect(peekProtocolVersion(JSON.stringify({ protocolVersion: '7', writtenBy: 'v3' }))).toStrictEqual(
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
    expect(variantForSnapshot(envelope('100'), registered, v1, neverResolvesWriter)).toStrictEqual(Either.right(v2));
    expect(variantForSnapshot(envelope('99'), registered, v1, neverResolvesWriter)).toStrictEqual(Either.right(v1));
  });

  it('falls back to the head variant for a snapshot that declares no version', () => {
    expect(variantForSnapshot(legacyEnvelope, neverResolves, v1, neverResolvesWriter)).toStrictEqual(Either.right(v1));
  });

  it('falls back to the head variant for an envelope it cannot read, leaving the real error to deserialization', () => {
    expect(variantForSnapshot('not json at all', neverResolves, v1, neverResolvesWriter)).toStrictEqual(
      Either.right(v1),
    );
  });

  it('reports a version no registered variant owns, naming it', () => {
    const routed = variantForSnapshot(envelope('4000'), registered, v1, neverResolvesWriter);

    const error = routed.pipe(Either.flip, Either.getOrThrow);
    expect(error).toBeInstanceOf(UnsupportedSnapshotVersionError);
    expect(error._tag).toBe('@midnightntwrk/wallet-sdk-shielded/Restore/UnsupportedSnapshotVersionError');
    expect(error.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(4000n));
  });
});

describe('peekWriter', () => {
  it('reads which variant a snapshot names as its writer', () => {
    expect(peekWriter(envelope('100', 'v1'))).toStrictEqual(Option.some('v1'));
    expect(peekWriter(envelope('100', 'v2'))).toStrictEqual(Option.some('v2'));
  });

  it('finds nothing in a snapshot written before snapshots named their writer', () => {
    expect(peekWriter(envelope('100'))).toStrictEqual(Option.none());
    expect(peekWriter(legacyEnvelope)).toStrictEqual(Option.none());
  });

  it('finds nothing, rather than throwing, when the writer named is not one it knows', () => {
    expect(peekWriter(JSON.stringify({ protocolVersion: '7', writtenBy: 'v3' }))).toStrictEqual(Option.none());
    expect(peekWriter('not json at all')).toStrictEqual(Option.none());
  });
});

describe('variantForSnapshot, for a snapshot that names its writer', () => {
  // The case the field exists for: the V1 variant saw the chain reach the fork and annotated the version before the
  // runtime handed it over, so the snapshot carries a version the V2 variant owns. It goes home to V1 all the same,
  // whose first observation announces the version and lets the runtime migrate it.
  it('routes to the variant that wrote it, whatever version it declares', () => {
    expect(variantForSnapshot(envelope('100', 'v1'), registered, v1, registeredWriter)).toStrictEqual(Either.right(v1));
    expect(variantForSnapshot(envelope('99', 'v2'), registered, v1, registeredWriter)).toStrictEqual(Either.right(v2));
  });

  it('routes by version when the writer it names is not registered, as a build with only the V2 variant does', () => {
    expect(variantForSnapshot(envelope('100', 'v1'), registered, v1, onlyV2Registered)).toStrictEqual(Either.right(v2));
    expect(variantForSnapshot(envelope('99', 'v1'), registered, v1, onlyV2Registered)).toStrictEqual(Either.right(v1));
  });

  it('routes by version when the snapshot names no writer, which every snapshot written before the field does', () => {
    expect(variantForSnapshot(envelope('100'), registered, v1, neverResolvesWriter)).toStrictEqual(Either.right(v2));
  });

  // A writer this build does not know is no reason to stop reading the envelope: the version is still there, and it
  // is the version that says whether any registered variant can read the snapshot. Blinding the peek would send the
  // snapshot to the head variant, whose deserializer refuses it as malformed instead of naming the version.
  it('routes by version when the writer it names is unknown, refusing an unowned version by name', () => {
    const unknownWriterAt = (protocolVersion: string): string => JSON.stringify({ protocolVersion, writtenBy: 'v3' });

    expect(variantForSnapshot(unknownWriterAt('100'), registered, v1, neverResolvesWriter)).toStrictEqual(
      Either.right(v2),
    );

    const error = variantForSnapshot(unknownWriterAt('4000'), registered, v1, neverResolvesWriter).pipe(
      Either.flip,
      Either.getOrThrow,
    );
    expect(error).toBeInstanceOf(UnsupportedSnapshotVersionError);
    expect(error.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(4000n));
  });
});
