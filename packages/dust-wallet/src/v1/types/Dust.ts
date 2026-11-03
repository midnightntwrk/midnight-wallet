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
import { type DustNullifier } from '@midnight-ntwrk/ledger-v8';
import { type Dust } from '../../types/DustWalletTypes.js';

export type {
  Dust,
  DustFullInfo,
  DustGenerationDetails,
  DustGenerationInfo,
  UtxoWithMeta,
} from '../../types/DustWalletTypes.js';

/** A Dust coin a pending transaction has spent: one booking of that coin, which a revert of that transaction releases. */
export type PendingDust = Readonly<{
  /** The coin as it was before the spend. Its own `ctime` is when the coin was created, not when it was spent. */
  coin: Dust;
  nullifier: DustNullifier;
  /**
   * The time the spending transaction declared in `dustActions.ctime`, in whole seconds as the ledger keeps it. The
   * ledger locks the coin until `declaredTime + dustGracePeriodSeconds`, and a coin can only be booked again after
   * that, so this tells one booking of a coin from a later one.
   */
  declaredTime: Date;
}>;
