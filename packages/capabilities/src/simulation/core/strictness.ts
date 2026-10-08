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

/**
 * Which well-formedness checks a simulated chain enforces, as plain configuration.
 *
 * The configuration and its presets say nothing about a ledger, so they are shared. Turning one into the ledger's
 * `WellFormedStrictness` object is per-ledger and stays with each simulator (`createStrictness`).
 */

/** Configuration for well-formedness strictness checks. All options default to false for testing flexibility. */
export type StrictnessConfig = Readonly<{
  enforceBalancing?: boolean;
  verifyNativeProofs?: boolean;
  verifyContractProofs?: boolean;
  enforceLimits?: boolean;
  verifySignatures?: boolean;
}>;

/**
 * Default strictness for post-genesis blocks.
 *
 * In a realistic simulation:
 *
 * - Signatures should be verified (verifySignatures: true)
 * - Proofs cannot be verified because they're erased (verifyNativeProofs/verifyContractProofs: false)
 * - Limits should be enforced (enforceLimits: true)
 * - Balancing must be enforced (enforceBalancing: true) - transactions must pay fees
 *
 * Note: Genesis blocks typically disable all strictness to allow initial token distribution.
 */
export const defaultStrictness: StrictnessConfig = {
  enforceBalancing: true,
  verifyNativeProofs: false,
  verifyContractProofs: false,
  enforceLimits: true,
  verifySignatures: true,
};

/** Strictness for genesis blocks - all checks disabled to allow initial token distribution. */
export const genesisStrictness: StrictnessConfig = {
  enforceBalancing: false,
  verifyNativeProofs: false,
  verifyContractProofs: false,
  enforceLimits: false,
  verifySignatures: false,
};
