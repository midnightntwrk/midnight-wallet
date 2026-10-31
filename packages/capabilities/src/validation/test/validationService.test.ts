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
import { describe, expect, it } from 'vitest';
import * as Validation from '../index.js';
import {
  type AnyV9ValidatableTransaction,
  type BlockData,
  type ValidateTxOptions,
  type ValidationService,
  type ValidationServiceDependencies,
  type ValidationServiceEffect,
  type ValidationServices,
  type VersionedValidationService,
  type VersionedValidationServiceEffect,
} from '../validationService.js';

describe('Naming the ledger version a validator is written against', () => {
  it('requires block data to name the ledger version its parameters are in, so none is ledger-v9 by omission', () => {
    // @ts-expect-error block data names the ledger version its parameters were decoded at
    type _1 = BlockData;
    // @ts-expect-error options name the ledger version of the block data they carry
    type _2 = ValidateTxOptions;
    // @ts-expect-error dependencies name the ledger version their fetcher decodes at
    type _3 = ValidationServiceDependencies;
  });

  it('requires every validator type to name the parameters it checks against, as well as the transactions', () => {
    // @ts-expect-error a validator names the ledger version of the parameters it checks against
    type _1 = ValidationServiceEffect<AnyV9ValidatableTransaction>;
    // @ts-expect-error a validator names the ledger version of the parameters it checks against
    type _2 = ValidationService<AnyV9ValidatableTransaction>;
    // @ts-expect-error a version-routed validator names the parameters it checks against
    type _3 = VersionedValidationServiceEffect<AnyV9ValidatableTransaction>;
    // @ts-expect-error a version-routed validator names the parameters it checks against
    type _4 = VersionedValidationService<AnyV9ValidatableTransaction>;
    // @ts-expect-error a registry names the parameters its validators check against
    type _5 = ValidationServices<AnyV9ValidatableTransaction>;
  });

  it("names the simulator's ledger version on the block-data fetcher that reads one", () => {
    expect(Validation).toHaveProperty('makeV9SimulatorBlockDataFetcher');
    expect(Validation).not.toHaveProperty('makeSimulatorBlockDataFetcher');
  });
});
