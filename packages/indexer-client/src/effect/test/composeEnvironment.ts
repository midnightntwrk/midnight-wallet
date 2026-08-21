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
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnightntwrk/wallet-sdk-utilities/testing';
import { randomUUID } from 'node:crypto';
import { DockerComposeEnvironment, Wait, type StartedDockerComposeEnvironment } from 'testcontainers';

/** Converts minutes to the milliseconds vitest hook/test timeouts expect. */
export const timeoutMinutes = (mins: number): number => 1_000 * 60 * mins;

/** A started (or startable) indexer+node compose stack, scoped to one test file. */
export interface ComposeTestEnvironment {
  /** Starts the stack; wire into `beforeAll` (allow `timeoutMinutes(3)` — image pulls are slow). */
  readonly start: () => Promise<void>;
  /** Tears the stack down; wire into `afterAll`. */
  readonly stop: () => Promise<void>;
  /** The indexer's mapped host port (falls back to 8088 before `start` resolves). */
  readonly getIndexerPort: () => number;
}

/**
 * The one compose scaffold every indexer-client integration test shares: a uniquely-named indexer+node environment
 * (unique so parallel test files never collide on container names), readiness gated on the node listening and the
 * indexer having indexed a block — connecting any earlier races indexer startup and flakes.
 *
 * @param composeFiles - Compose file name(s) under the shared compose directory; overrides later in the list win, e.g.
 *   `['docker-compose.yml', 'docker-compose.ws-no-deflate.yml']`.
 */
export const makeComposeEnvironment = (composeFiles: string | string[]): ComposeTestEnvironment => {
  const environmentId = randomUUID();

  const environmentVars = buildTestEnvironmentVariables(['APP_INFRA_SECRET'], {
    additionalVars: {
      TESTCONTAINERS_UID: environmentId,
    },
  });

  const environment = new DockerComposeEnvironment(getComposeDirectory(), composeFiles)
    .withWaitStrategy(`node_${environmentId}`, Wait.forListeningPorts())
    .withWaitStrategy(`indexer_${environmentId}`, Wait.forLogMessage(/block indexed/))
    .withEnvironment(environmentVars);

  // Mutation is deliberate and confined to this helper: the started environment only exists
  // after the async `start` hook runs, which is inherently stateful test setup
  // (`.claude/rules/functional-style.md` permits this).
  let startedEnvironment: StartedDockerComposeEnvironment | undefined = undefined;

  return {
    start: async () => {
      startedEnvironment = await environment.up();
    },
    stop: async () => {
      await startedEnvironment?.down();
    },
    getIndexerPort: () => startedEnvironment?.getContainer(`indexer_${environmentId}`).getMappedPort(8088) ?? 8088,
  };
};
