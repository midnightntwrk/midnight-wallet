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
import { WalletSeed } from '@midnightntwrk/wallet-sdk-abstractions';
import { Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import * as StartMaterial from '../StartMaterial.js';

/** Stands in for a ledger's key object: what a variant derives from the seed it is handed. */
type Keys = Readonly<{ derivedFrom: string; ledger: string }>;

const seed = WalletSeed.fromString('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff');
const otherSeed = WalletSeed.fromString('ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100');

const v1Tag = Symbol('ledger-v8');
const v2Tag = Symbol('ledger-v9');

/** Each variant derives its own ledger's key type from whatever seed it is given. */
const derivedBy =
  (ledger: string) =>
  (given: WalletSeed.WalletSeed): Keys => ({ derivedFrom: Buffer.from(given).toString('hex'), ledger });

const neverDerives = (): Keys => {
  throw new Error('The derivation must not be consulted for material that already carries key objects');
};

describe('StartMaterial', () => {
  describe('retained as a seed', () => {
    it('derives key material for whichever variant asks, using that variant s own derivation', () => {
      const retained = StartMaterial.fromSeed<Keys>(seed);

      expect(StartMaterial.auxFor(retained, v1Tag, derivedBy('v8'))).toStrictEqual(
        Option.some({ derivedFrom: Buffer.from(seed).toString('hex'), ledger: 'v8' }),
      );
      expect(StartMaterial.auxFor(retained, v2Tag, derivedBy('v9'))).toStrictEqual(
        Option.some({ derivedFrom: Buffer.from(seed).toString('hex'), ledger: 'v9' }),
      );
    });

    it('hands over the seed it retained, not some other one', () => {
      const retained = StartMaterial.fromSeed<Keys>(otherSeed);

      expect(StartMaterial.auxFor(retained, v2Tag, derivedBy('v9'))).toStrictEqual(
        Option.some({ derivedFrom: Buffer.from(otherSeed).toString('hex'), ledger: 'v9' }),
      );
    });

    it('answers for a variant that was never named, which is the point of retaining a seed', () => {
      const retained = StartMaterial.fromSeed<Keys>(seed);

      expect(
        Option.isSome(StartMaterial.auxFor(retained, Symbol('a variant nobody has heard of'), derivedBy('vN'))),
      ).toBe(true);
    });
  });

  describe('retained as key objects', () => {
    it('returns the key material registered for the variant that asks', () => {
      const v8Keys: Keys = { derivedFrom: 'elsewhere', ledger: 'v8' };
      const v9Keys: Keys = { derivedFrom: 'elsewhere', ledger: 'v9' };
      const retained = StartMaterial.forVariants<Keys>([
        [v1Tag, v8Keys],
        [v2Tag, v9Keys],
      ]);

      expect(StartMaterial.auxFor(retained, v1Tag, neverDerives)).toStrictEqual(Option.some(v8Keys));
      expect(StartMaterial.auxFor(retained, v2Tag, neverDerives)).toStrictEqual(Option.some(v9Keys));
    });

    it('reports a miss for a variant it holds no key material for, rather than handing over another variant s', () => {
      const retained = StartMaterial.forVariant<Keys>(v1Tag, { derivedFrom: 'elsewhere', ledger: 'v8' });

      expect(StartMaterial.auxFor(retained, v2Tag, neverDerives)).toStrictEqual(Option.none());
    });

    it('treats a single variant s key material as the one-entry case', () => {
      const keys: Keys = { derivedFrom: 'elsewhere', ledger: 'v9' };

      expect(StartMaterial.forVariant<Keys>(v2Tag, keys)).toStrictEqual(
        StartMaterial.forVariants<Keys>([[v2Tag, keys]]),
      );
    });
  });

  describe('requiring key material a variant can use', () => {
    it('produces the key material when the wallet holds some for that variant', () => {
      expect(StartMaterial.requireAuxFor(StartMaterial.fromSeed<Keys>(seed), v2Tag, derivedBy('v9'))).toStrictEqual(
        Either.right({ derivedFrom: Buffer.from(seed).toString('hex'), ledger: 'v9' }),
      );
    });

    it('fails typed, naming the variant, when the wallet holds none that variant can use', () => {
      const retained = StartMaterial.forVariant<Keys>(v1Tag, { derivedFrom: 'elsewhere', ledger: 'v8' });

      const resolved = StartMaterial.requireAuxFor(retained, v2Tag, neverDerives);

      const error = resolved.pipe(Either.flip, Either.getOrThrow);
      expect(error).toBeInstanceOf(StartMaterial.MissingStartAuxError);
      expect(error._tag).toBe('@midnightntwrk/wallet-sdk-runtime/abstractions/StartMaterial/MissingStartAuxError');
      expect(error.variantTag).toBe(v2Tag);
    });
  });

  describe('deriving for a variant whose key type differs from the retained one', () => {
    it('derives from a retained seed, whatever the asking variant s key type is', () => {
      const otherLedgerKeys = (given: WalletSeed.WalletSeed): string => `v8:${Buffer.from(given).toString('hex')}`;

      const derived = StartMaterial.requireDerivedAuxFor(StartMaterial.fromSeed<Keys>(seed), v1Tag, otherLedgerKeys);

      expect(derived).toStrictEqual(Either.right(`v8:${Buffer.from(seed).toString('hex')}`));
    });

    it('fails typed when the wallet retained key objects rather than a seed', () => {
      // Key objects belong to one ledger version's runtime. There is nothing to convert, so a variant
      // speaking another one can only be served by re-deriving from a seed the wallet does not hold.
      const retained = StartMaterial.forVariant<Keys>(v2Tag, { derivedFrom: 'elsewhere', ledger: 'v9' });

      const derived = StartMaterial.requireDerivedAuxFor(retained, v1Tag, (): string => {
        throw new Error('must not derive: nothing was retained to derive from');
      });

      const error = derived.pipe(Either.flip, Either.getOrThrow);
      expect(error).toBeInstanceOf(StartMaterial.MissingStartAuxError);
      expect(error.variantTag).toBe(v1Tag);
    });
  });
});
