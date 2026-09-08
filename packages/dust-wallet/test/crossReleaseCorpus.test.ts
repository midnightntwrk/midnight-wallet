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
// Snapshots written by the last pre-fork release of the SDK, replayed on this build. See
// `scripts/cross-release-corpus/README.md`; the short version is that every other serialization test round-trips a
// snapshot this code wrote a moment earlier, which cannot see a format that drifted between releases.
//
// Only the empty shape is here so far. Generating a *funded* dust snapshot on the pre-fork release means driving a
// real dust chain through that release's simulator, since a dust UTXO and the generation entry behind it are produced
// by a registration rather than constructed; that is worth doing and is not done yet.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Either, pipe } from 'effect';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { describe, expect, it } from 'vitest';
import { makeDefaultV1SerializationCapability } from '../src/v1/Serialization.js';

const corpus = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cross-release');
const fixture = (name: string): string => readFileSync(join(corpus, `${name}.json`), 'utf8');
const provenance = JSON.parse(readFileSync(join(corpus, 'provenance.json'), 'utf8')) as {
  generatedFrom: { sdk: string; ledger: string };
};

describe('a Dust snapshot written by the last pre-fork release', () => {
  it('records which release wrote it, so a stale fixture cannot pass as a parity check', () => {
    expect(provenance.generatedFrom.sdk).toMatch(/^1\./);
    expect(provenance.generatedFrom.ledger).toMatch(/^8\./);
  });

  it('restores on this build, with the identity and the network the pre-fork release wrote', () => {
    const wallet = pipe(
      makeDefaultV1SerializationCapability().deserialize(null, fixture('dust-empty')),
      EitherOps.getOrThrowLeft,
    );

    expect(wallet.networkId).toBe('undeployed');
    expect(wallet.state.utxos.length).toBe(0);
    expect(wallet.publicKey).toBeDefined();
  });

  it('is refused with a typed error when its bytes are not a snapshot at all', () => {
    // The neighbouring negative, kept here so the corpus reader is known to be discriminating rather than permissive.
    const result = makeDefaultV1SerializationCapability().deserialize(null, '{"not":"a snapshot"}');

    expect(Either.isLeft(result)).toBe(true);
  });
});
