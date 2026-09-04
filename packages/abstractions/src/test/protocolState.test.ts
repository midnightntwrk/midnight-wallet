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
import { Equivalence } from 'effect';
import { describe, expect, it } from 'vitest';
import * as ProtocolState from '../ProtocolState.js';
import * as ProtocolVersion from '../ProtocolVersion.js';

const preFork: ProtocolState.ProtocolState<number, 'pre' | 'post'> = {
  version: ProtocolVersion.ProtocolVersion(8n),
  variantTag: 'pre',
  state: 42,
};

const equals = ProtocolState.getEquivalence(Equivalence.number);

describe('ProtocolState', () => {
  it('projects the state out', () => {
    expect(ProtocolState.state(preFork)).toBe(42);
  });

  describe('getEquivalence', () => {
    it('holds for identical version, producing variant and state', () => {
      expect(equals(preFork, { ...preFork })).toBe(true);
    });

    it('distinguishes states produced by different variants', () => {
      expect(equals(preFork, { ...preFork, variantTag: 'post' })).toBe(false);
    });

    it('distinguishes different protocol versions', () => {
      expect(equals(preFork, { ...preFork, version: ProtocolVersion.ProtocolVersion(9n) })).toBe(false);
    });

    it('defers to the supplied state equivalence', () => {
      expect(equals(preFork, { ...preFork, state: 43 })).toBe(false);
      expect(ProtocolState.getEquivalence<number>(() => true)(preFork, { ...preFork, state: 43 })).toBe(true);
    });
  });
});
