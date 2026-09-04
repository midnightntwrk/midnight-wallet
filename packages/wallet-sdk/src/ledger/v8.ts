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
 * The pre-fork ledger version, for an application that builds its own transactions.
 *
 * @remarks
 *   The version every chain is on until it crosses the protocol boundary — mainnet included, until the fork happens. An
 *   application authoring transactions for a chain that has not yet forked imports this one, and seals what it built
 *   with `WalletTransaction.adopt('Unproven', tx, version)` at a version below the fork.
 *
 *   Named for the ledger version rather than for a variant ordinal, so the import line says which rules the bytes follow.
 *   See {@link ../ledger/v9} for the post-fork version and for what authoring costs an application in general; the
 *   choice between the two is a property of the chain, and an application that spans the boundary reads the protocol
 *   version from the wallet's state and authors accordingly.
 *
 *   Deliberately not part of the root barrel: this is WebAssembly, and an application that only carries transactions
 *   should not pay for a ledger it never names.
 * @example
 *   ```typescript
 *   import * as ledger from '@midnightntwrk/wallet-sdk/ledger/v8';
 *   import { WalletTransaction } from '@midnightntwrk/wallet-sdk';
 *
 *   const authored = ledger.Transaction.fromParts(networkId, undefined, undefined, intent);
 *   const handle = WalletTransaction.adopt('Unproven', authored, state.activeProtocolVersion);
 *   ```;
 */
export * from '@midnight-ntwrk/ledger-v8';
