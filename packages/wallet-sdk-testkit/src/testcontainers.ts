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
//
// Docker-backed environment provisioning. Kept behind the `@midnightntwrk/wallet-sdk-testkit/
// testcontainers` entry point so consumers that only target remote networks never load
// `testcontainers` or `@midnightntwrk/wallet-sdk-utilities` (both declared as optional peers).
import { randomUUID } from 'node:crypto';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnightntwrk/wallet-sdk-utilities/testing';
import { type MidnightNetwork, type ResolvedEndpoints, type WalletTestEnvironment } from './types.js';
import { NETWORK_PRESETS, makeEnvironment } from './environment.js';
import { sleep } from './network.js';
import { logger } from './logger.js';

const PROOF_SERVER_PORT = 6300;
const NODE_PORT_RPC = 9944;
const INDEXER_PORT = 8088;

/** Configuration for {@link createTestContainersEnvironment}. */
export interface TestContainersEnvironmentConfig {
  network: MidnightNetwork;
  /** Environment variables forwarded into the compose environment. Default: `['APP_INFRA_SECRET']`. */
  passEnv?: readonly string[];
  /** Startup timeout for the remote-network proof-server, in ms. Default: 100000. */
  startupTimeoutMs?: number;
}

const mappedPort = (env: StartedDockerComposeEnvironment, container: string, port: number): number =>
  env.getContainer(container).getMappedPort(port);

const resolveUndeployedEndpoints = (env: StartedDockerComposeEnvironment, uid: string): ResolvedEndpoints => {
  const indexerPort = mappedPort(env, `indexer_${uid}`, INDEXER_PORT);
  return {
    networkId: NetworkId.NetworkId.Undeployed,
    proverUrl: `http://localhost:${mappedPort(env, `proof-server_${uid}`, PROOF_SERVER_PORT)}`,
    indexerHttpUrl: `http://localhost:${indexerPort}/api/v3/graphql`,
    indexerWsUrl: `ws://localhost:${indexerPort}/api/v4/graphql/ws`,
    nodeUrl: `ws://localhost:${mappedPort(env, `node_${uid}`, NODE_PORT_RPC)}`,
  };
};

/**
 * Spins up the local docker-compose stack and returns a {@link WalletTestEnvironment}.
 *
 * - `undeployed`: full local stack (proof-server + node + indexer), endpoints resolved from mapped ports.
 * - Remote networks: a local proof-server only, combined with the public indexer/node preset. This is the case the
 *   downstream `PROOF_SERVER_URL` patch used to bypass; downstream consumers should instead use
 *   `createRemoteEnvironment` with an explicit `proverUrl` and skip Docker entirely.
 */
export const createTestContainersEnvironment = async (
  config: TestContainersEnvironmentConfig,
): Promise<WalletTestEnvironment> => {
  const { network } = config;
  const passEnv = config.passEnv ?? (['APP_INFRA_SECRET'] as const);
  const uid = randomUUID();

  logger.info(`Spinning up ${network} test environment...`);

  if (network === 'undeployed') {
    const environmentVars = buildTestEnvironmentVariables(passEnv, { additionalVars: { TESTCONTAINERS_UID: uid } });
    const composeEnvironment = await new DockerComposeEnvironment(getComposeDirectory(), 'docker-compose-dynamic.yml')
      .withWaitStrategy(`proof-server_${uid}`, Wait.forListeningPorts())
      .withWaitStrategy(`node_${uid}`, Wait.forListeningPorts())
      .withWaitStrategy(`indexer_${uid}`, Wait.forListeningPorts())
      .withEnvironment(environmentVars)
      .up();
    // wait for another block to be produced
    await sleep(6);
    logger.info('Test environment started');
    return makeEnvironment('undeployed', resolveUndeployedEndpoints(composeEnvironment, uid), {
      down: async () => {
        await composeEnvironment.down({ timeout: 10_000, removeVolumes: true });
      },
    });
  }

  const environmentVars = buildTestEnvironmentVariables(passEnv, {
    additionalVars: { TESTCONTAINERS_UID: uid, NETWORK_ID: network },
  });
  const composeEnvironment = await new DockerComposeEnvironment(
    getComposeDirectory(),
    'docker-compose-remote-dynamic.yml',
  )
    .withWaitStrategy(`proof-server_${uid}`, Wait.forLogMessage('Actix runtime found; starting in Actix runtime'))
    .withEnvironment(environmentVars)
    .withStartupTimeout(config.startupTimeoutMs ?? 100_000)
    .up();
  logger.info('Test environment started');

  const preset = NETWORK_PRESETS[network];
  const endpoints: ResolvedEndpoints = {
    ...preset,
    proverUrl: `http://localhost:${mappedPort(composeEnvironment, `proof-server_${uid}`, PROOF_SERVER_PORT)}`,
  };
  return makeEnvironment(network, endpoints, {
    down: async () => {
      await composeEnvironment.down({ timeout: 10_000, removeVolumes: true });
    },
  });
};
