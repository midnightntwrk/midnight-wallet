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
 * Sealing a transaction a test built, and opening one the wallet handed back.
 *
 * @remarks
 *   These suites are both authors and inspectors: they hand-build transactions to see what the wallet does with them, and
 *   then read identifiers and imbalances off what it returns. Neither is what an ordinary application does, which is
 *   why the two directions are named here rather than scattered — an application carries a handle and never opens it.
 */
import { ProtocolVersion, WalletTransaction, type AnyTx, type WalletFacade } from '@midnightntwrk/wallet-sdk';
import { Either } from 'effect';

/**
 * Seals a transaction a test built for itself, at the version the facade that will use it is acting at.
 *
 * @remarks
 *   The facade is asked rather than told. A fixed version is right on one chain and wrong on the next: a local chain born
 *   on ledger-v9 reports the fork version from genesis, a live network still below the boundary reports the minimum,
 *   and a later fork adds a third answer. `adoptTransaction` reads the bytes with the ledger the facade is acting on,
 *   so a test that built them with the other ledger fails here, by name, instead of being refused further down.
 */
export const sealed = <TStage extends WalletTransaction.Stage>(
  facade: Pick<WalletFacade, 'adoptTransaction'>,
  stage: TStage,
  transaction: { serialize: () => Uint8Array },
): WalletTransaction<TStage> => facade.adoptTransaction(transaction.serialize(), stage);

/**
 * Reads the transaction a handle carries, at exactly the version it says it was built at.
 *
 * @remarks
 *   A one-wide range: a test that opens a handle is asking for the transaction it is holding and no other, so the version
 *   it names is the handle's own. The result type is the caller's to name — which is the choice the stamp has already
 *   settled, so naming the wrong ledger version fails on the very next line.
 */
export const carried = <T>(handle: AnyTx): T =>
  Either.getOrThrow(
    WalletTransaction.unwrapWithin<T>(
      handle,
      ProtocolVersion.makeRange(handle.protocolVersion, ProtocolVersion.ProtocolVersion(handle.protocolVersion + 1n)),
    ),
  );
