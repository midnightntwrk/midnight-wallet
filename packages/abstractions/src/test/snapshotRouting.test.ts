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
import { Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { ProtocolVersion } from '../ProtocolVersion.js';
import { type SnapshotWriter } from '../SnapshotFormat.js';
import { readEnvelope, routeSnapshot, type SnapshotEnvelope } from '../SnapshotRouting.js';

const version = (n: bigint) => ProtocolVersion(n);

const envelope = (fields: Record<string, unknown>): string =>
  JSON.stringify({ state: 'deadbeef', networkId: 'undeployed', ...fields });

const noInference = (): Option.Option<SnapshotWriter> => {
  throw new Error('inferWriter must not be consulted when the snapshot names a writer this build knows');
};

describe('reading a snapshot envelope', () => {
  it('reads the protocol version and a known writer, ignoring every other field', () => {
    expect(readEnvelope(envelope({ protocolVersion: '100', writtenBy: 'v1' }))).toStrictEqual({
      protocolVersion: Option.some(version(100n)),
      writer: Option.some('v1'),
    });
    expect(readEnvelope(envelope({ protocolVersion: '7', writtenBy: 'v2' })).writer).toStrictEqual(Option.some('v2'));
  });

  it('reads the version whatever the writer field holds, so an unknown or malformed writer cannot blind it', () => {
    ['v3', null, 7, {}, [], ''].forEach((writtenBy) => {
      expect(readEnvelope(envelope({ protocolVersion: '4000', writtenBy }))).toStrictEqual({
        protocolVersion: Option.some(version(4000n)),
        writer: Option.none(),
      });
    });
  });

  it('reads the writer whatever the version field holds, so a malformed version cannot blind it', () => {
    expect(readEnvelope(envelope({ protocolVersion: 'tomorrow', writtenBy: 'v1' }))).toStrictEqual({
      protocolVersion: Option.none(),
      writer: Option.some('v1'),
    });
    expect(readEnvelope(envelope({ protocolVersion: null, writtenBy: 'v2' })).writer).toStrictEqual(Option.some('v2'));
  });

  it('finds neither in a snapshot that declares neither, or in something that is not a snapshot at all', () => {
    const nothing: SnapshotEnvelope = { protocolVersion: Option.none(), writer: Option.none() };

    expect(readEnvelope(envelope({}))).toStrictEqual(nothing);
    expect(readEnvelope('not json at all')).toStrictEqual(nothing);
    expect(readEnvelope('[]')).toStrictEqual(nothing);
    expect(readEnvelope('"a string"')).toStrictEqual(nothing);
    expect(readEnvelope('')).toStrictEqual(nothing);
  });

  it('asks the inference hook only when no known writer is named, and takes its answer', () => {
    const inferV1 = (json: unknown): Option.Option<SnapshotWriter> =>
      typeof json === 'object' && json !== null && 'bareKey' in json ? Option.some('v1') : Option.none();

    expect(readEnvelope(envelope({ protocolVersion: '100', writtenBy: 'v2' }), noInference).writer).toStrictEqual(
      Option.some('v2'),
    );
    expect(readEnvelope(envelope({ protocolVersion: '100', bareKey: true }), inferV1).writer).toStrictEqual(
      Option.some('v1'),
    );
    expect(
      readEnvelope(envelope({ protocolVersion: '100', writtenBy: 'v3', bareKey: true }), inferV1).writer,
    ).toStrictEqual(Option.some('v1'));
    expect(readEnvelope(envelope({ protocolVersion: '100' }), inferV1).writer).toStrictEqual(Option.none());
    expect(readEnvelope('not json at all', inferV1).writer).toStrictEqual(Option.none());
  });
});

describe('routing a snapshot envelope to a variant', () => {
  const v1 = { name: 'V1 variant' };
  const v2 = { name: 'V2 variant' };
  type Variant = typeof v1;

  /** Ledger-v8 below 100, ledger-v9 from 100, nothing from 1000. */
  const variantFor = (v: ProtocolVersion): Option.Option<Variant> =>
    v >= 1000n ? Option.none() : Option.some(v >= 100n ? v2 : v1);
  /** Where each variant starts answering, as the wallet registered them: V1 from the minimum, V2 from 100. */
  const activationOf = (variant: Variant): ProtocolVersion => (variant === v2 ? version(100n) : version(0n));
  const bothRegistered = (writer: SnapshotWriter): Option.Option<Variant> => Option.some(writer === 'v1' ? v1 : v2);
  const onlyV2Registered = (writer: SnapshotWriter): Option.Option<Variant> =>
    writer === 'v2' ? Option.some(v2) : Option.none();
  const neverByVersion = (): Option.Option<Variant> => {
    throw new Error('must not route by version');
  };
  const neverByWriter = (): Option.Option<Variant> => {
    throw new Error('must not route by writer');
  };
  const unsupported = (v: ProtocolVersion) => ({ unsupported: v });

  const at = (protocolVersion: Option.Option<ProtocolVersion>, writer: Option.Option<SnapshotWriter>) => ({
    protocolVersion,
    writer,
  });

  it('routes to the variant that wrote it when that variant is registered and the version is not below where it starts', () => {
    // The fork window: V1 wrote it after annotating a version V2 owns. V1 takes it and hands over forwards.
    expect(
      routeSnapshot({
        envelope: at(Option.some(version(100n)), Option.some('v1')),
        variantFor: neverByVersion,
        headVariant: v1,
        variantWrittenBy: bothRegistered,
        activationOf,
        unsupported,
      }),
    ).toStrictEqual(Either.right(v1));
    // The writer's own range, and a version past every registered range: the last variant's range is open-ended.
    expect(
      routeSnapshot({
        envelope: at(Option.some(version(100n)), Option.some('v2')),
        variantFor: neverByVersion,
        headVariant: v1,
        variantWrittenBy: bothRegistered,
        activationOf,
        unsupported,
      }),
    ).toStrictEqual(Either.right(v2));
    expect(
      routeSnapshot({
        envelope: at(Option.some(version(4000n)), Option.some('v2')),
        variantFor: neverByVersion,
        headVariant: v1,
        variantWrittenBy: bothRegistered,
        activationOf,
        unsupported,
      }),
    ).toStrictEqual(Either.right(v2));
  });

  // The runtime only hands a wallet forwards, so a writer started below the version it activates at would announce a
  // version no later variant owns and the wallet would die after a successful restore. Such a snapshot routes by
  // version instead: a V2-written snapshot that never synced (version 0) starts where a wallet with no history starts.
  it('routes by version when the declared version is below where the writer starts, since the writer cannot hand over backwards', () => {
    expect(
      routeSnapshot({
        envelope: at(Option.some(version(0n)), Option.some('v2')),
        variantFor,
        headVariant: v1,
        variantWrittenBy: bothRegistered,
        activationOf,
        unsupported,
      }),
    ).toStrictEqual(Either.right(v1));
    expect(
      routeSnapshot({
        envelope: at(Option.some(version(99n)), Option.some('v2')),
        variantFor,
        headVariant: v1,
        variantWrittenBy: bothRegistered,
        activationOf,
        unsupported,
      }),
    ).toStrictEqual(Either.right(v1));
  });

  it('routes by version when the writer is not registered, or when none is named', () => {
    expect(
      routeSnapshot({
        envelope: at(Option.some(version(100n)), Option.some('v1')),
        variantFor,
        headVariant: v1,
        variantWrittenBy: onlyV2Registered,
        activationOf,
        unsupported,
      }),
    ).toStrictEqual(Either.right(v2));
    expect(
      routeSnapshot({
        envelope: at(Option.some(version(99n)), Option.none()),
        variantFor,
        headVariant: v2,
        variantWrittenBy: neverByWriter,
        activationOf,
        unsupported,
      }),
    ).toStrictEqual(Either.right(v1));
  });

  it('routes to the writer when no version is declared, and to the head variant when neither is', () => {
    expect(
      routeSnapshot({
        envelope: at(Option.none(), Option.some('v2')),
        variantFor: neverByVersion,
        headVariant: v1,
        variantWrittenBy: bothRegistered,
        activationOf,
        unsupported,
      }),
    ).toStrictEqual(Either.right(v2));
    expect(
      routeSnapshot({
        envelope: at(Option.none(), Option.none()),
        variantFor: neverByVersion,
        headVariant: v2,
        variantWrittenBy: neverByWriter,
        activationOf,
        unsupported,
      }),
    ).toStrictEqual(Either.right(v2));
  });

  it('reports a version no registered variant owns through the error the caller builds, naming it', () => {
    expect(
      routeSnapshot({
        envelope: at(Option.some(version(4000n)), Option.none()),
        variantFor,
        headVariant: v1,
        variantWrittenBy: neverByWriter,
        activationOf,
        unsupported,
      }),
    ).toStrictEqual(Either.left({ unsupported: version(4000n) }));
  });
});
