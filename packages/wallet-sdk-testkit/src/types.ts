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
import { type NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { type DefaultV1Configuration } from '@midnightntwrk/wallet-sdk-shielded/v1';
import { type DefaultV1Configuration as DefaultDustV1Configuration } from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
import { type DefaultProvingConfiguration } from '@midnightntwrk/wallet-sdk-capabilities/proving';
import { type DefaultSubmissionConfiguration } from '@midnightntwrk/wallet-sdk-capabilities/submission';

/** Networks a wallet test environment can target. */
export type MidnightNetwork = 'undeployed' | 'qanet' | 'devnet' | 'preview' | 'preprod';

/** A remote (already-running) network — anything other than the local testcontainers stack. */
export type RemoteNetwork = Exclude<MidnightNetwork, 'undeployed'>;

/**
 * The fully-resolved set of service endpoints a wallet needs. This is the single source of truth that replaces the
 * env-var + container-port resolution previously baked into `TestContainersFixture`. Callers either let an environment
 * factory resolve these or supply them directly.
 */
export interface ResolvedEndpoints {
  readonly networkId: NetworkId.NetworkId;
  /** Proof-server base URL, e.g. `http://localhost:6300`. No public default exists. */
  readonly proverUrl: string;
  readonly indexerHttpUrl: string;
  readonly indexerWsUrl: string;
  /** Node RPC (relay) URL, e.g. `wss://rpc.devnet.midnight.network`. */
  readonly nodeUrl: string;
}

/** Shielded + submission + proving configuration consumed by `ShieldedWallet`/`WalletFacade`. */
export type WalletConfiguration = DefaultV1Configuration & DefaultSubmissionConfiguration & DefaultProvingConfiguration;

/** Dust wallet configuration consumed by `DustWallet`. */
export type DustWalletConfiguration = DefaultDustV1Configuration;

/**
 * A provisioned wallet test environment. Produced by {@link createRemoteEnvironment} (no Docker) or
 * `createTestContainersEnvironment` (from the `/testcontainers` entry point). Replaces the old `TestContainersFixture`
 * class — the wallet-config builders are identical, but the endpoints are injected rather than read from `process.env`
 * / mapped container ports.
 */
export interface WalletTestEnvironment {
  readonly network: MidnightNetwork;
  readonly endpoints: ResolvedEndpoints;
  getWalletConfig(): WalletConfiguration;
  getDustWalletConfig(): DustWalletConfiguration;
  /** Tears down any resources (containers) the environment owns. No-op for remote environments. */
  down(): Promise<void>;
}
