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
import type * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import type * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { type CanAssign, type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { describe, expect, it } from 'vitest';
import { type V8UnboundTransaction, type V9UnboundTransaction } from '../../proving/index.js';
import * as Submission from '../index.js';
import { makeDefaultSubmissionService, makeDefaultSubmissionServiceEffect } from '../submissionService.js';

const UNUSED_RELAY = new URL('ws://localhost:9944');

// Never called: only their types are read, so no service is built and no relay is dialled.
const _unnamedEffectService = () => makeDefaultSubmissionServiceEffect({ relayURL: UNUSED_RELAY });
const _unnamedService = () => makeDefaultSubmissionService({ relayURL: UNUSED_RELAY });

type SubmittedBy<TService extends { submitTransaction: (...args: never[]) => unknown }> = Parameters<
  TService['submitTransaction']
>[0];

describe('Naming the ledger version a submission service is written against', () => {
  it("submits either ledger version's transactions when none is named, because the node takes their bytes", () => {
    type _1 = Expect<CanAssign<ledgerV8.FinalizedTransaction, SubmittedBy<ReturnType<typeof _unnamedEffectService>>>>;
    type _2 = Expect<CanAssign<ledgerV9.FinalizedTransaction, SubmittedBy<ReturnType<typeof _unnamedEffectService>>>>;
    type _3 = Expect<CanAssign<ledgerV8.FinalizedTransaction, SubmittedBy<ReturnType<typeof _unnamedService>>>>;
    type _4 = Expect<CanAssign<ledgerV9.FinalizedTransaction, SubmittedBy<ReturnType<typeof _unnamedService>>>>;
  });

  it('submits nothing but a finalized transaction when none is named, because only those reach a block', () => {
    type EffectSubmits = SubmittedBy<ReturnType<typeof _unnamedEffectService>>;
    type Submits = SubmittedBy<ReturnType<typeof _unnamedService>>;

    type _1 = Expect<Equal<CanAssign<ledgerV8.UnprovenTransaction, EffectSubmits>, false>>;
    type _2 = Expect<Equal<CanAssign<ledgerV9.UnprovenTransaction, EffectSubmits>, false>>;
    type _3 = Expect<Equal<CanAssign<ledgerV9.LedgerParameters, EffectSubmits>, false>>;
    type _4 = Expect<Equal<CanAssign<ledgerV8.UnprovenTransaction, Submits>, false>>;
    type _5 = Expect<Equal<CanAssign<ledgerV9.UnprovenTransaction, Submits>, false>>;
    type _6 = Expect<Equal<CanAssign<ledgerV9.LedgerParameters, Submits>, false>>;
    type _7 = Expect<Equal<CanAssign<V8UnboundTransaction, EffectSubmits>, false>>;
    type _8 = Expect<Equal<CanAssign<V9UnboundTransaction, EffectSubmits>, false>>;
    type _9 = Expect<Equal<CanAssign<V8UnboundTransaction, Submits>, false>>;
    type _10 = Expect<Equal<CanAssign<V9UnboundTransaction, Submits>, false>>;
  });

  it("names the simulator's ledger version on the submission service that reads one", () => {
    expect(Submission).toHaveProperty('makeV9SimulatorSubmissionService');
    expect(Submission).not.toHaveProperty('makeSimulatorSubmissionService');
  });
});
