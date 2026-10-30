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
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { VariantState } from '../VariantState.js';

/** Two variants' tags, as a wallet package declares them: one unique symbol per variant. */
const v1Tag: unique symbol = Symbol('V1');
const v2Tag: unique symbol = Symbol('V2');

/** A stand-in for a variant's core state: an object of whichever ledger version that variant runs. */
type LedgerLikeState = Readonly<{ ledgerVersion: string; commitmentTreeRoot: () => string }>;

const ledgerLikeState = (ledgerVersion: string): LedgerLikeState => ({
  ledgerVersion,
  commitmentTreeRoot: () => `root-of-${ledgerVersion}`,
});

describe('VariantState', () => {
  describe('seal', () => {
    it('does not expose the state it carries', () => {
      const state = ledgerLikeState('v9');
      const handle = VariantState.seal(v2Tag, state);

      expect(Object.keys(handle)).toStrictEqual([]);
      expect(Object.values(handle)).not.toContain(state);
      // @ts-expect-error the carried state is unreachable through the handle, which is the point of it
      expect(handle.state).toBeUndefined();
    });
  });

  describe('unwrapFor', () => {
    it('hands the state over to the variant that sealed it', () => {
      const state = ledgerLikeState('v9');

      expect(VariantState.unwrapFor<LedgerLikeState>(VariantState.seal(v2Tag, state), v2Tag)).toStrictEqual(
        Option.some(state),
      );
    });

    it('hands nothing to another variant, whose ledger version could not read the state', () => {
      const handle = VariantState.seal(v1Tag, ledgerLikeState('v8'));

      expect(VariantState.unwrapFor<LedgerLikeState>(handle, v2Tag)).toStrictEqual(Option.none());
    });

    it('tells apart two variants whose tags share a description, as unique symbols do', () => {
      // Every wallet package names its variants `V1` and `V2`; only the symbol's identity says whose variant it is.
      const anotherPackagesV2Tag: unique symbol = Symbol('V2');
      const handle = VariantState.seal(v2Tag, ledgerLikeState('v9'));

      expect(VariantState.unwrapFor<LedgerLikeState>(handle, anotherPackagesV2Tag)).toStrictEqual(Option.none());
    });
  });

  describe('is', () => {
    it('recognises a handle', () => {
      expect(VariantState.is(VariantState.seal(v2Tag, ledgerLikeState('v9')))).toBe(true);
    });

    it('rejects an object that merely carries a state', () => {
      expect(VariantState.is({ state: ledgerLikeState('v9') })).toBe(false);
    });

    it('rejects values that are not objects at all', () => {
      expect(VariantState.is(undefined)).toBe(false);
      expect(VariantState.is('V2')).toBe(false);
    });
  });
});
