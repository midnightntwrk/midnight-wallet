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
//
// The exact shape of the bytes a shielded wallet writes, pinned for both variants.
//
// The serialization coverage in each variant is `serialize ◦ deserialize == id` plus rejection cases. A round trip
// cannot see a renamed field: rename `offset` to `cursor` in the schema and both halves move together, the round trip
// still passes, and every snapshot ever written becomes unreadable. Nothing else in the package looks at the wire
// format, so today that rename is a silent, shipping-blocking change.
//
// What is pinned is the envelope — field names, nesting and the encoder each field goes through — and NOT the opaque
// ledger blob. `state` is the hex of `ZswapLocalState.serialize()`, and pinning those bytes would turn every ledger
// bump into a failure here rather than in the place that owns the encoding. So it is asserted to be a hex string, and
// its content is left to the ledger.
//
// Both variants are pinned in one file, and asserted to agree, because that agreement is itself load-bearing: the two
// are meant to write the same envelope, so a snapshot written by either reads on the other. A per-variant test in each
// variant's own directory could not state that.
//
// Tier: unit.
import * as preForkLedger from '@midnight-ntwrk/ledger-v8';
import * as postForkLedger from '@midnightntwrk/ledger-v9';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { Array as Arr, Order, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet as PreForkWallet } from '../v1/CoreWallet.js';
import { makeDefaultV1SerializationCapability } from '../v1/Serialization.js';
import { CoreWallet as PostForkWallet } from '../v2/CoreWallet.js';
import { makeDefaultV2SerializationCapability } from '../v2/Serialization.js';

const networkId = NetworkId.NetworkId.Undeployed;
const seedHex = '0000000000000000000000000000000000000000000000000000000000000001';
// Each variant must be handed ITS OWN ledger module's objects: these are wasm-bindgen instances owned by the module
// that made them, and handing one tree the other's fails inside the ledger rather than at the type level.
const seed = () => Uint8Array.from(Buffer.from(seedHex, 'hex'));
const preForkKeys = () => preForkLedger.ZswapSecretKeys.fromSeed(seed());
const postForkKeys = () => postForkLedger.ZswapSecretKeys.fromSeed(seed());

const isJsonArray = Schema.is(Schema.Array(Schema.Unknown));
const isJsonObject = Schema.is(Schema.Record({ key: Schema.String, value: Schema.Unknown }));

/**
 * Leaf paths of a decoded snapshot, in `a.b[].c` form, so one assertion pins the envelope's whole field structure.
 *
 * @remarks
 *   An array contributes the paths of its first element, which is enough for a homogeneous collection but does mean a
 *   heterogeneous one is under-described. Empty containers contribute `[]` and `{}` markers rather than vanishing —
 *   without that, an optional field that happens to be empty would drop out of the pin and its removal would go
 *   unnoticed.
 * @param value The decoded JSON to walk.
 * @param prefix The path accumulated so far.
 * @returns Every leaf path, unsorted.
 */
const keyPaths = (value: unknown, prefix = ''): readonly string[] => {
  if (isJsonArray(value)) {
    return value.length === 0 ? [`${prefix}[]`] : keyPaths(value[0], `${prefix}[]`);
  }
  if (isJsonObject(value)) {
    const entries = Object.entries(value);
    return entries.length === 0
      ? [`${prefix}{}`]
      : entries.flatMap(([key, nested]) => keyPaths(nested, prefix === '' ? key : `${prefix}.${key}`));
  }
  return [prefix];
};

const sorted = (paths: readonly string[]) => Arr.sort(paths, Order.string);

/** A wallet whose cursor is set, so the optional `offset` is present and its absence would be visible. */
const preForkWallet = () =>
  PreForkWallet.updateProgress(PreForkWallet.initEmpty(preForkKeys(), networkId), { appliedIndex: 42n });

const postForkWallet = () =>
  PostForkWallet.updateProgress(PostForkWallet.initEmpty(postForkKeys(), networkId), { appliedIndex: 42n });

/**
 * The envelope both variants are contracted to write.
 *
 * @remarks
 *   `coinHashes{}` is the empty-record marker. An empty wallet has no coin hashes, and without the marker the field would
 *   contribute no path at all — so deleting it from the schema would leave this pin unchanged.
 */
const expectedPaths = [
  'coinHashes{}',
  'networkId',
  'offset',
  'protocolVersion',
  'publicKeys.coinPublicKey',
  'publicKeys.encryptionPublicKey',
  'state',
];

describe('the shielded snapshot envelope', () => {
  it('is the pinned shape on the pre-fork variant', () => {
    const parsed: unknown = JSON.parse(makeDefaultV1SerializationCapability().serialize(preForkWallet()));

    expect(sorted(keyPaths(parsed))).toEqual(sorted(expectedPaths));
  });

  it('is the pinned shape on the post-fork variant', () => {
    const parsed: unknown = JSON.parse(makeDefaultV2SerializationCapability().serialize(postForkWallet()));

    expect(sorted(keyPaths(parsed))).toEqual(sorted(expectedPaths));
  });

  it('is the same shape on both variants, which is what lets either read the other’s snapshot', () => {
    const preFork: unknown = JSON.parse(makeDefaultV1SerializationCapability().serialize(preForkWallet()));
    const postFork: unknown = JSON.parse(makeDefaultV2SerializationCapability().serialize(postForkWallet()));

    expect(sorted(keyPaths(preFork))).toEqual(sorted(keyPaths(postFork)));
  });

  it('encodes each field the way the reader expects, and leaves the ledger blob to the ledger', () => {
    // The encoders, not just the names. `offset` and `protocolVersion` are bigints written as decimal strings — a
    // change to a JSON number would round-trip for small values and silently lose precision for real ones.
    const parsed = JSON.parse(makeDefaultV2SerializationCapability().serialize(postForkWallet())) as {
      offset: unknown;
      protocolVersion: unknown;
      publicKeys: { coinPublicKey: unknown; encryptionPublicKey: unknown };
      networkId: unknown;
      state: unknown;
      coinHashes: unknown;
    };

    expect(typeof parsed.offset).toBe('string');
    expect(parsed.offset).toBe('42');
    expect(typeof parsed.protocolVersion).toBe('string');
    expect(typeof parsed.publicKeys.coinPublicKey).toBe('string');
    expect(typeof parsed.publicKeys.encryptionPublicKey).toBe('string');
    expect(parsed.networkId).toBe(networkId);
    expect(parsed.coinHashes).toEqual({});
    // Opaque on purpose: hex, non-empty, and otherwise the ledger's business.
    expect(parsed.state).toMatch(/^[0-9a-f]+$/);
  });
});
