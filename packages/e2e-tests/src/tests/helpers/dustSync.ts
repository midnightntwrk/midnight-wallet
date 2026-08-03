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
import { type DustWalletFactory, eventLessDustWallet } from '@midnightntwrk/wallet-sdk-testkit/core';

export {
  eventBasedDustWallet,
  type DustWalletFactory,
  eventLessDustWallet,
} from '@midnightntwrk/wallet-sdk-testkit/core';

/**
 * Options selecting the projections-based dust sync, for the remote tests that build wallets through this package's own
 * helpers rather than through a testkit scenario.
 *
 * The testkit scenarios already default to this factory, so `dust.remote` and `tokenTransfer.remote` do not pass it —
 * leaving that default load-bearing means our own remote lane exercises what downstream consumers get.
 */
export const remoteDustSyncOptions: { readonly dustWallet: DustWalletFactory } = {
  dustWallet: eventLessDustWallet,
};
