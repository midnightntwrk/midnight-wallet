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
 * The format version this build writes into a shielded snapshot. It versions the encoded shape of the snapshot and is
 * not `protocolVersion`, which is the chain's hard-fork number and lives inside it.
 *
 * Snapshots written before this field existed carry the same fields under a different name for the same shape, so a
 * missing `version` reads as this one and no upgrade runs. The field earns its keep on the day the shape does change:
 * that shape becomes `v2` and a single v1-to-v2 step is written, rather than every reader having to guess.
 *
 * Declared here, with no ledger import, so that both variants share one constant and neither pulls the other's ledger
 * into its module graph to read it.
 */
export const SNAPSHOT_FORMAT_VERSION = 'v1';
