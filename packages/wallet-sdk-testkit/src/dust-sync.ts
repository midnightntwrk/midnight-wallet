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
import {
  CustomDustWallet,
  type DefaultDustConfiguration,
  DustWallet,
  type DustWalletClass,
  makeEventLessSyncCapability,
  makeEventLessSyncService,
} from '@midnightntwrk/wallet-sdk-dust-wallet';
import { V1Builder } from '@midnightntwrk/wallet-sdk-dust-wallet/v1';

/** The factory shape {@link provideWallet} and the scenarios accept for the dust sub-wallet. */
export type DustWalletFactory = (config: DefaultDustConfiguration) => DustWalletClass;

/**
 * A dust sub-wallet that syncs from indexer projections instead of the event stream.
 *
 * This is the default for the healthcheck scenarios, so the networks they monitor are exercised against the projections
 * sync. The sync service has to be swapped in at build time, so a wallet built without this factory gets the
 * event-based sync no matter what else it configures.
 *
 * Background syncing is left enabled — the facade's `manualSync` flag would additionally require the caller to drive
 * `doSync()` by hand.
 */
export const eventLessDustWallet: DustWalletFactory = (config) =>
  CustomDustWallet(
    config,
    new V1Builder().withDefaults().withSync(makeEventLessSyncService, makeEventLessSyncCapability),
  );

/** The event-stream dust sub-wallet. Pass this to opt a scenario back out of the projections sync. */
export const eventBasedDustWallet: DustWalletFactory = DustWallet;
