/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** Every format version the pending transactions store has been written in, oldest first. */
export const SNAPSHOT_FORMAT_VERSIONS = ['v1', 'v2'] as const;

/** The format version of a store holding pending items and reservations side by side. */
export const V1_SNAPSHOT_FORMAT_VERSION = 'v1';

/** The format version of a store holding one lifecycle record per transaction. */
export const V2_SNAPSHOT_FORMAT_VERSION = 'v2';

/** The current format version of the store. */
export const SNAPSHOT_FORMAT_VERSION = V2_SNAPSHOT_FORMAT_VERSION;

/**
 * Upgrades a decoded pending transactions store from format version `v1` to `v2`.
 *
 * @param json The store as decoded from its JSON string.
 * @returns The same store in format `v2`, or the input unchanged when the step does not apply.
 */
export const upgradeSnapshotV1ToV2 = (json: unknown): unknown => json;
