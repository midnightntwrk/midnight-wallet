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
// Snapshots written by the **last pre-fork release** of the SDK, replayed on this build.
//
// Everything else in the suite round-trips a snapshot this code wrote a moment earlier, which cannot see a format that
// drifted between releases: writer and reader move together, so both sides are wrong in the same way and agree. These
// fixtures were produced by the published pre-fork packages and committed, so they stay fixed while this code changes
// around them. Regenerating them is a deliberate act — see `scripts/cross-release-corpus/README.md`.
//
// This is the upgrade path an application actually takes: a wallet whose state was written before the fork, opened by
// a build that has crossed it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Either, HashMap, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { peekProtocolVersion, variantForSnapshot } from '../src/Restore.js';
import { makeDefaultV1SerializationCapability } from '../src/v1/Serialization.js';

const corpus = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cross-release');
const fixture = (name: string): string => readFileSync(join(corpus, `${name}.json`), 'utf8');
const provenance = JSON.parse(readFileSync(join(corpus, 'provenance.json'), 'utf8')) as {
  generatedFrom: { sdk: string; ledger: string };
};

const restored = (name: string) => {
  const result = makeDefaultV1SerializationCapability().deserialize(fixture(name));
  expect(Either.isRight(result)).toBe(true);
  if (Either.isLeft(result)) throw new Error(String(result.left));
  return result.right;
};

describe('an unshielded snapshot written by the last pre-fork release', () => {
  it('records which release wrote it, so a stale fixture cannot pass as a parity check', () => {
    // Asserted rather than assumed: a hand-edited fixture is a snapshot no release ever produced, and would prove
    // nothing while looking exactly like proof.
    expect(provenance.generatedFrom.sdk).toMatch(/^1\./);
    expect(provenance.generatedFrom.ledger).toMatch(/^8\./);
  });

  it('is routed to the variant that owns the version it declares', () => {
    // The dual-ledger build's own dispatch, not a serializer chosen by the test: this is what an application's
    // `restore` does with a snapshot it is handed.
    const declared = peekProtocolVersion(fixture('unshielded-funded'));
    expect(Option.isSome(declared)).toBe(true);

    const chosen = variantForSnapshot(
      fixture('unshielded-funded'),
      (version) => (version < ProtocolVersion.V9NativeForkVersion ? Option.some('V1' as const) : Option.none()),
      'V2' as const,
    );
    expect(chosen).toStrictEqual(Either.right('V1'));
  });

  it('carries a wallet that had seen nothing', () => {
    const wallet = restored('unshielded-empty');

    expect(HashMap.size(wallet.state.availableUtxos)).toBe(0);
    expect(HashMap.size(wallet.state.pendingUtxos)).toBe(0);
  });

  it('carries its UTXOs, on the sides the pre-fork release put them', () => {
    const wallet = restored('unshielded-funded');

    expect(HashMap.size(wallet.state.availableUtxos)).toBe(1);
    expect(HashMap.size(wallet.state.pendingUtxos)).toBe(1);
    expect([...HashMap.values(wallet.state.availableUtxos)][0].utxo.intentHash).toBe('intent-available');
    expect([...HashMap.values(wallet.state.pendingUtxos)][0].utxo.intentHash).toBe('intent-pending');
  });

  it('carries a value the pre-fork release wrote that a double cannot hold', () => {
    const carried = [...HashMap.values(restored('unshielded-funded').state.availableUtxos)][0];

    expect(carried.utxo.value).toBe(9_007_199_254_740_993n);
    expect(typeof carried.utxo.value).toBe('bigint');
  });

  it('carries the metadata under each UTXO, including both dust-registration states', () => {
    const wallet = restored('unshielded-funded');
    const available = [...HashMap.values(wallet.state.availableUtxos)][0];
    const pending = [...HashMap.values(wallet.state.pendingUtxos)][0];

    expect(available.meta.ctime).toBeInstanceOf(Date);
    expect(available.meta.ctime.toISOString()).toBe('2026-03-04T05:06:07.008Z');
    expect(available.meta.registeredForDustGeneration).toBe(true);
    expect(pending.meta.registeredForDustGeneration).toBe(false);
  });

  it('reads the legacy bare-string verifying key the pre-fork release wrote', () => {
    // The format difference this corpus exists to catch, and it is real: the pre-fork release writes the key as a bare
    // hexadecimal string, while this build writes a tagged record. Read from the fixture's own bytes rather than
    // asserted about in the abstract.
    const onTheWire = JSON.parse(fixture('unshielded-funded')) as { publicKey: { publicKey: unknown } };
    expect(typeof onTheWire.publicKey.publicKey).toBe('string');

    expect(restored('unshielded-funded').publicKey.addressHex).toBe(
      (JSON.parse(fixture('unshielded-funded')) as { publicKey: { addressHex: string } }).publicKey.addressHex,
    );
  });
});
