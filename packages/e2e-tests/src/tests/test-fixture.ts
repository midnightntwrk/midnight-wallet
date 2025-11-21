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
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { exit } from 'process';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { StartedGenericContainer } from 'testcontainers/build/generic-container/started-generic-container';
import { MidnightNetwork } from './utils.js';
import { logger } from './logger.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DefaultV1Configuration } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { DefaultV1Configuration as DefaultDustV1Configuration } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { getComposeDirectory, buildTestEnvironmentVariables } from '@midnight-ntwrk/wallet-sdk-utilities/testing';

export function useTestContainersFixture() {
  let fixture: TestContainersFixture | undefined;

  beforeAll(async () => {
    logger.info(`Spinning up ${process.env['NETWORK']} test environment...`);
    const uid = Math.floor(Math.random() * 1000).toString();
    const network = process.env['NETWORK'] as MidnightNetwork;
    let composeEnvironment: StartedDockerComposeEnvironment;

    const envVarsToPass = ['APP_INFRA_SECRET'] as const;

    switch (network) {
      case 'undeployed': {
        const environmentVars = buildTestEnvironmentVariables(envVarsToPass, {
          additionalVars: {
            TESTCONTAINERS_UID: uid,
          },
        });

        composeEnvironment = await new DockerComposeEnvironment(getComposeDirectory(), 'docker-compose-dynamic.yml')
          .withWaitStrategy(`proof-server_${uid}`, Wait.forListeningPorts())
          .withWaitStrategy(`node_${uid}`, Wait.forListeningPorts())
          .withWaitStrategy(`indexer_${uid}`, Wait.forListeningPorts())
          .withEnvironment(environmentVars)
          .up();
        break;
      }
      case 'devnet':
      case 'qanet':
      case 'testnet':
      case 'preview':
      case 'preprod': {
        const environmentVars = buildTestEnvironmentVariables(envVarsToPass, {
          additionalVars: {
            TESTCONTAINERS_UID: uid,
            NETWORK_ID: network,
          },
        });

        composeEnvironment = await new DockerComposeEnvironment(
          getComposeDirectory(),
          'docker-compose-remote-dynamic.yml',
        )
          .withWaitStrategy(`proof-server_${uid}`, Wait.forLogMessage('Actix runtime found; starting in Actix runtime'))
          .withEnvironment(environmentVars)
          .up();
        break;
      }
      default: {
        logger.warn(`Unrecognized network: ${network}`);
        exit(1);
      }
    }
    logger.info('Test environment started');
    fixture = new TestContainersFixture(composeEnvironment, uid);
  }, 120_000);

  afterAll(async () => {
    logger.info('Tearing down test environment...');
    await fixture?.down();
    logger.info('Test environment torn down');
  }, 60_000);

  return () => fixture!;
}

export class TestContainersFixture {
  public readonly composeEnvironment: StartedDockerComposeEnvironment;
  private readonly uid: string | undefined;

  constructor(composeEnvironment: StartedDockerComposeEnvironment, uid?: string) {
    this.composeEnvironment = composeEnvironment;
    this.uid = uid;
  }

  public async down() {
    await this.composeEnvironment.down({ timeout: 10_000, removeVolumes: true });
  }

  public static readonly PROOF_SERVER_PORT = 6300;
  public static readonly NODE_PORT_RPC = 9944;
  public static readonly INDEXER_PORT = 8088;
  static readonly network = process.env['NETWORK'] as MidnightNetwork;

  public getProofServerContainer(): StartedGenericContainer {
    return this.composeEnvironment.getContainer(`proof-server_${this.uid}`);
  }

  public getNodeContainer(): StartedGenericContainer {
    return this.composeEnvironment.getContainer(`node_${this.uid}`);
  }

  public getIndexerContainer(): StartedGenericContainer {
    return this.composeEnvironment.getContainer(`indexer_${this.uid}`);
  }

  public getProverUri(): string {
    const proofServerPort = this.getProofServerContainer().getMappedPort(TestContainersFixture.PROOF_SERVER_PORT);
    return `http://localhost:${proofServerPort}`;
  }

  private getIndexerPort(): number {
    return this.getIndexerContainer().getMappedPort(TestContainersFixture.INDEXER_PORT);
  }

  public getIndexerUri(): string {
    switch (TestContainersFixture.network) {
      case 'testnet': {
        return 'https://indexer.testnet-02.midnight.network/api/v3/graphql';
      }
      case 'qanet': {
        return 'https://indexer.qanet.dev.midnight.network/api/v3/graphql';
      }
      case 'preview': {
        return 'https://indexer.preview.midnight.network/api/v3/graphql';
      }
      case 'preprod': {
        return 'https://indexer.preprod.midnight.network/api/v3/graphql';
      }
      case 'node-dev-01': {
        return 'https://indexer.node-dev-01.midnight.network/api/v3/graphql';
      }
      case 'undeployed': {
        const indexerPort = this.getIndexerPort();
        return `http://localhost:${indexerPort}/api/v3/graphql`;
      }
      default: {
        throw new Error(`Unrecognized network: ${String(TestContainersFixture.network)}`);
      }
    }
  }

  public getIndexerWsUri(): string {
    switch (TestContainersFixture.network) {
      case 'testnet': {
        return 'wss://indexer.testnet-02.midnight.network/api/v3/graphql/ws';
      }
      case 'qanet': {
        return 'wss://indexer.qanet.dev.midnight.network/api/v3/graphql/ws';
      }
      case 'preview': {
        return 'wss://indexer.preview.midnight.network/api/v3/graphql/ws';
      }
      case 'preprod': {
        return 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws';
      }
      case 'node-dev-01': {
        return 'wss://indexer.node-dev-01.midnight.network/api/v3/graphql/ws';
      }
      case 'undeployed': {
        const indexerPort = this.getIndexerPort();
        return `ws://localhost:${indexerPort}/api/v3/graphql/ws`;
      }
      default: {
        throw new Error(`Unrecognized network: ${String(TestContainersFixture.network)}`);
      }
    }
  }

  public getNodeUri(): string {
    switch (TestContainersFixture.network) {
      case 'testnet': {
        return 'https://rpc.testnet-02.midnight.network';
      }
      case 'qanet': {
        return 'https://rpc.qanet.dev.midnight.network';
      }
      case 'preview': {
        return 'https://rpc.preview.midnight.network';
      }
      case 'preprod': {
        return 'https://rpc.preprod.midnight.network';
      }
      case 'node-dev-01': {
        return 'https://rpc.node-dev-01.midnight.network';
      }
      case 'undeployed': {
        const nodePortRpc = this.getNodeContainer().getMappedPort(TestContainersFixture.NODE_PORT_RPC);
        return `ws://localhost:${nodePortRpc}`;
      }
      default: {
        throw new Error(`Unrecognized network: ${String(TestContainersFixture.network)}`);
      }
    }
  }

  public getNetworkId(): NetworkId.NetworkId {
    switch (TestContainersFixture.network) {
      case 'undeployed':
        return NetworkId.NetworkId.Undeployed;
      case 'devnet':
        return NetworkId.NetworkId.DevNet;
      case 'qanet':
        return NetworkId.NetworkId.QaNet;
      case 'testnet':
        return NetworkId.NetworkId.TestNet;
      case 'preview':
        return NetworkId.NetworkId.Preview;
      case 'preprod':
        return NetworkId.NetworkId.PreProd;
      default:
        throw new Error(`Unrecognized network: ${String(TestContainersFixture.network)}`);
    }
  }

  public getWalletConfig(): DefaultV1Configuration {
    return {
      indexerClientConnection: {
        indexerHttpUrl: this.getIndexerUri(),
        indexerWsUrl: this.getIndexerWsUri(),
      },
      provingServerUrl: new URL(this.getProverUri()),
      relayURL: new URL(this.getNodeUri()),
      networkId: this.getNetworkId(),
    };
  }

  public getDustWalletConfig(): DefaultDustV1Configuration {
    return {
      networkId: this.getNetworkId(),
      costParameters: {
        additionalFeeOverhead: 300_000_000_000_000n,
        feeBlocksMargin: 5,
      },
    };
  }
}
