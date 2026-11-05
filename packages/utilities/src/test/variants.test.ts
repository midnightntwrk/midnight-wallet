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
import { eitherCoreStateOf } from '../testing/variants.js';

/** A wallet state, tagged with the variant that produced it, as each variant's reader tells them apart. */
type WalletState = Readonly<{ producedBy: 'V1' | 'V2' | 'neither' }>;

const v1CoreStateOf = (state: WalletState): Option.Option<string> =>
  state.producedBy === 'V1' ? Option.some('v1 core') : Option.none();
const v2CoreStateOf = (state: WalletState): Option.Option<string> =>
  state.producedBy === 'V2' ? Option.some('v2 core') : Option.none();

describe('eitherCoreStateOf', () => {
  it('reads a state the V2 variant produced with the V2 reader', () => {
    expect(eitherCoreStateOf({ producedBy: 'V2' }, v2CoreStateOf, v1CoreStateOf)).toBe('v2 core');
  });

  it('reads a state the V1 variant produced with the V1 reader', () => {
    expect(eitherCoreStateOf({ producedBy: 'V1' }, v2CoreStateOf, v1CoreStateOf)).toBe('v1 core');
  });

  it('fails for a state neither variant produced, rather than reading it as one of them', () => {
    expect(() => eitherCoreStateOf({ producedBy: 'neither' }, v2CoreStateOf, v1CoreStateOf)).toThrow();
  });
});
