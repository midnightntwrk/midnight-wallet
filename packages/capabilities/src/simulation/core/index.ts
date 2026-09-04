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
 * Simulator internals that are the same whichever ledger a simulated chain runs.
 *
 * The pre-fork (ledger-v8) and post-fork (ledger-v9) simulators are otherwise twins, so anything here is written once
 * instead of once per version. The rule for what belongs: it must not name a ledger type. Everything that constructs or
 * applies ledger objects — the ledger state, transactions, strictness objects, genesis minting — stays in the
 * per-version simulators, because that is what genuinely differs between them.
 *
 * Not a published entry point; re-exported through each version's barrel.
 */

export {
  getProtocolVersion,
  protocolVersionAt,
  scheduleFork,
  setProtocolVersion,
  type ScheduledFork,
  type VersionTimeline,
} from './VersionTimeline.js';

export { blockHash, nextBlockContextFromBlock, type BlockContext, type PreviousBlock } from './blocks.js';

export { defaultStrictness, genesisStrictness, type StrictnessConfig } from './strictness.js';
