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

// The pull-request smoke lane selects tests by `@smoke` in their name; every other snippet runs only in the nightly run.
// A shielded transfer is in it because it shows that a shielded transaction lands and that both wallets record it in
// their history, and that nothing the wallet logs on the way, such as a warning about a history write cut off, leaks into
// a snippet's output: changes to a wallet's sync or stop could otherwise break that unseen until the nightly run.
export const SMOKE_SNIPPETS: ReadonlySet<string> = new Set(['shielded-transfer']);

/** The snippet with the title its test runs under: its name, tagged `@smoke` when the smoke lane runs it. */
export const withSmokeTag = <T extends { name: string }>(snippet: T): T & { title: string } => ({
  ...snippet,
  title: SMOKE_SNIPPETS.has(snippet.name) ? `${snippet.name} @smoke` : snippet.name,
});
