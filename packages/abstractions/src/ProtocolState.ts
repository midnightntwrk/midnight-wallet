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
import type * as ProtocolVersion from './ProtocolVersion.js';

/**
 * A type that associates some state with a given version of the Midnight protocol.
 *
 * @typeParam TState The type of state.
 */
export type ProtocolState<TState> = Readonly<{ version: ProtocolVersion.ProtocolVersion; state: TState }>;

export const state = <TState>(ps: ProtocolState<TState>): TState => ps.state;
