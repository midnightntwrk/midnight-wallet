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
 * How long the remote healthchecks allow for syncing their wallets. A pair of wallets built from scratch on a
 * long-lived network such as preprod took about 20 minutes on CI when no other wallet was syncing; a wallet restored
 * from the sync cache takes a few. The testkit's own defaults stay lower for its other consumers.
 */
export const REMOTE_SYNC_TIMEOUT_MS = 45 * 60 * 1000;
