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
import { Option } from 'effect';

/**
 * The core state of whichever of a wallet's two variants produced a wallet state.
 *
 * @remarks
 *   For a test or tool that follows a wallet across a protocol boundary. Each variant's `coreStateOf` answers only for
 *   the states that variant produced, so the V2 variant is asked first and the V1 variant after; a state neither
 *   produced fails rather than reading as one of them.
 * @example
 *   ```typescript
 *   import { coreStateOf as v1CoreStateOf } from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
 *   import { coreStateOf as v2CoreStateOf } from '@midnightntwrk/wallet-sdk-dust-wallet/v2';
 *
 *   const core = eitherCoreStateOf(await dustWallet.waitForSyncedState(), v2CoreStateOf, v1CoreStateOf);
 *   ```;
 *
 * @param walletState A state, as the wallet emits it.
 * @param v2CoreStateOf The V2 variant's `coreStateOf`.
 * @param v1CoreStateOf The V1 variant's `coreStateOf`.
 * @returns The core state of whichever variant produced `walletState`.
 * @throws NoSuchElementException When neither variant produced it.
 */
export const eitherCoreStateOf = <TWalletState, TV1CoreState, TV2CoreState>(
  walletState: TWalletState,
  v2CoreStateOf: (walletState: TWalletState) => Option.Option<TV2CoreState>,
  v1CoreStateOf: (walletState: TWalletState) => Option.Option<TV1CoreState>,
): TV1CoreState | TV2CoreState =>
  Option.getOrThrow(Option.orElse(v2CoreStateOf(walletState), () => v1CoreStateOf(walletState)));
