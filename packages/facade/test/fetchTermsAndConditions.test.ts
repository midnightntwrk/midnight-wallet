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
import { randomUUID } from 'node:crypto';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import { DockerComposeEnvironment, Wait, type StartedDockerComposeEnvironment } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WalletFacade } from '../src/index.js';

const timeout_minutes = (mins: number) => 1_000 * 60 * mins;

const environmentId = randomUUID();
const INDEXER_PORT = 8088;

const environmentVars = buildTestEnvironmentVariables(['APP_INFRA_SECRET'], {
  additionalVars: {
    TESTCONTAINERS_UID: environmentId,
  },
});

const environment = new DockerComposeEnvironment(getComposeDirectory(), 'docker-compose.yml')
  .withWaitStrategy(`indexer_${environmentId}`, Wait.forLogMessage(/block indexed/))
  .withEnvironment(environmentVars);

describe('WalletFacade.fetchTermsAndConditions', () => {
  let startedEnvironment: StartedDockerComposeEnvironment | undefined = undefined;
  const getIndexerHttpUrl = () => {
    const port =
      startedEnvironment?.getContainer(`indexer_${environmentId}`)?.getMappedPort(INDEXER_PORT) ?? INDEXER_PORT;
    return `http://localhost:${port}/api/v4/graphql`;
  };

  beforeAll(async () => {
    startedEnvironment = await environment.up();
  }, timeout_minutes(3));

  afterAll(async () => {
    await startedEnvironment?.down();
  }, timeout_minutes(1));

  it(
    'returns a URL and a valid SHA-256 hash',
    async () => {
      const termsAndConditions = await WalletFacade.fetchTermsAndConditions({
        indexerClientConnection: {
          indexerHttpUrl: getIndexerHttpUrl(),
        },
      });

      const parsedUrl = new URL(termsAndConditions.url);
      expect(parsedUrl.protocol).toMatch(/^https?:$/);
      expect(parsedUrl.hostname).toBeTruthy();

      // SHA-256 hash is 256 bits = 64 hex characters
      expect(termsAndConditions.hash).toMatch(/^[0-9a-fA-F]{64}$/);
    },
    timeout_minutes(1),
  );
});
