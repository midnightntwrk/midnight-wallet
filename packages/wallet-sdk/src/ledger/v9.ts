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
 * Ledger-v9, for an application that builds its own transactions.
 *
 * @remarks
 *   Most applications never need this. They ask the wallet for a transfer or a swap, carry what comes back as a
 *   `WalletTransaction`, and hand it straight to the next call — and because the handle never names a ledger version,
 *   nothing they wrote has to change when the chain crosses the protocol boundary.
 *
 *   An application that reaches for `Intent.new` or `Transaction.fromParts` is doing something different: it is
 *   authoring, and authoring means choosing which ledger version's rules the bytes follow. That choice cannot be hidden
 *   behind a version-free API, so this subpath makes it explicit and importable from the one package the application
 *   already depends on. Seal the result with `WalletTransaction.adopt('Unproven', tx, version)` to hand it back.
 *
 *   **Which one to import is a property of the chain, not of this release.** Both are shipped, side by side, because both
 *   are real: a chain is on ledger-v8 until it forks, and mainnet is on ledger-v8 until then. An authoring path that
 *   only ever imports `./ledger/v9` type-checks perfectly and fails at run time, with a `ProtocolVersionMismatchError`,
 *   on every chain that has not yet crossed — the wallet refuses a transaction built for a version it is not acting at.
 *   An application that must work either side of the boundary reads the protocol version from the wallet's state and
 *   authors accordingly.
 *
 *   Deliberately not part of the root barrel: this is WebAssembly, and an application that only carries transactions
 *   should not pay for a ledger it never names.
 * @example
 *   ```typescript
 *   import * as ledger from '@midnightntwrk/wallet-sdk/ledger/v9';
 *   import { WalletTransaction } from '@midnightntwrk/wallet-sdk';
 *
 *   const authored = ledger.Transaction.fromParts(networkId, undefined, undefined, intent);
 *   const handle = WalletTransaction.adopt('Unproven', authored, state.activeProtocolVersion);
 *   ```;
 */
export * from '@midnightntwrk/ledger-v9';
