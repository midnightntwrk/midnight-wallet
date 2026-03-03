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
import { Effect } from 'effect';
import type { Query } from './Query.js';
import type { QueryClient } from './QueryClient.js';
import * as HttpQueryClient from './HttpQueryClient.js';

/**
 * Executes a {@link Query} as a `Promise` using the {@link HttpQueryClient}.
 *
 * @param query The query to execute.
 * @param variables The variables to supply to the query.
 * @param config The server configuration (URL) for the HTTP query client.
 * @returns A `Promise` that resolves with the query result.
 */
export const runPromise = <R, V>(query: Query<R, V>, variables: V, config: QueryClient.ServerConfig): Promise<R> =>
  query.run(variables).pipe(Effect.provide(HttpQueryClient.layer(config)), Effect.scoped, Effect.runPromise);
