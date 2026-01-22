// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import { Data } from 'effect';
import { type ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';

/**
 * A tagged enum data type that represents a change in Midnight protocol versions.
 *
 * @remarks
 * A specific protocol version can be specified using the {@link VersionChangeType.Version} enum variant. It has a
 * `version` property that accepts a {@link ProtocolVersion} value for a known protocol version.
 * For use cases where a specific protocol version cannot be given, the {@link VersionChangeType.Next} enum variant
 * can be used. Its use is context specific.
 */
export type VersionChangeType = Data.TaggedEnum<{
  /** A change to a particular protocol version. */
  Version: { readonly version: ProtocolVersion.ProtocolVersion };

  /** A change to the 'next' protocol version. Particularly useful in testing */
  Next: {}; // eslint-disable-line @typescript-eslint/no-empty-object-type
}>;
const VersionChangeType = Data.taggedEnum<VersionChangeType>();

/**
 * A type predicate that determines if a given value is a {@link VersionChangeType.Version} enum variant.
 */
export const isVersion = VersionChangeType.$is('Version');

/**
 * A type predicate that determines if a given value is a {@link VersionChangeType.Next} enum variant.
 */
export const isNext = VersionChangeType.$is('Next');

export const { $match: match, Version, Next } = VersionChangeType;
