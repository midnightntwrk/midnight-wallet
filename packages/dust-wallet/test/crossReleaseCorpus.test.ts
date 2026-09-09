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
// Snapshots written by the last SDK release on the ledger-v8 line, replayed on this build. See
// `scripts/cross-release-corpus/README.md`; the short version is that every other serialization test round-trips a
// snapshot this code wrote a moment earlier, which cannot see a format that drifted between releases.
//
// Only the empty shape is here so far. Generating a *funded* dust snapshot on that release means driving a
// real dust chain through that release's simulator, since a dust UTXO and the generation entry behind it are produced
// by a registration rather than constructed; that is worth doing and is not done yet.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipe } from 'effect';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { describe, expect, it } from 'vitest';
import { makeDefaultV1SerializationCapability } from '../src/v1/Serialization.js';

/**
 * The corpus this file asserts against, named by the release that wrote it.
 *
 * Explicit rather than discovered: the values below — which coins, which cursor — are facts about _this_ release's
 * output, so a second corpus from a later release is a second block of cases, not the same ones pointed elsewhere.
 */
const FROM_RELEASE = 'from-1.2.0';

const corpus = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cross-release', FROM_RELEASE);
const fixture = (name: string): string => readFileSync(join(corpus, `${name}.json`), 'utf8');
describe('a Dust snapshot written by the last ledger-v8 release', () => {
  it('restores on this build, with the identity and the network that release wrote', () => {
    const wallet = pipe(
      makeDefaultV1SerializationCapability().deserialize(null, fixture('dust-empty')),
      EitherOps.getOrThrowLeft,
    );

    expect(wallet.networkId).toBe('undeployed');
    expect(wallet.state.utxos.length).toBe(0);
    expect(wallet.publicKey).toBeDefined();
  });
});
