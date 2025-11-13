/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { exit } from 'process';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { StartedGenericContainer } from 'testcontainers/build/generic-container/started-generic-container';
import { MidnightNetwork } from './utils.js';
import { logger } from './logger.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import path from 'node:path';
import { DefaultV1Configuration } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { DefaultV1Configuration as DefaultDustV1Configuration } from '@midnight-ntwrk/wallet-sdk-dust-wallet';

const dockerPath = path.resolve(new URL(import.meta.url).pathname, '../../../');

export function useTestContainersFixture() {
  let fixture: TestContainersFixture | undefined;

  beforeAll(async () => {
    logger.info(`Spinning up ${process.env['NETWORK']} test environment...`);
    const uid = Math.floor(Math.random() * 1000).toString();
    let composeEnvironment: StartedDockerComposeEnvironment;
    switch (process.env['NETWORK'] as MidnightNetwork) {
      case 'undeployed': {
        composeEnvironment = await new DockerComposeEnvironment(dockerPath, 'docker-compose-dynamic.yml')
          .withWaitStrategy(`proof-server_${uid}`, Wait.forListeningPorts())
          .withWaitStrategy(`node_${uid}`, Wait.forListeningPorts())
          .withWaitStrategy(`indexer_${uid}`, Wait.forListeningPorts())
          .withEnvironment({ TESTCONTAINERS_UID: uid })
          .up();
        break;
      }
      case 'devnet': {
        composeEnvironment = await new DockerComposeEnvironment(dockerPath, 'docker-compose-remote-dynamic.yml')
          .withWaitStrategy(`proof-server_${uid}`, Wait.forLogMessage('Actix runtime found; starting in Actix runtime'))
          .withEnvironment({ TESTCONTAINERS_UID: uid, NETWORK_ID: 'devnet' })
          .up();
        break;
      }
      case 'qanet': {
        composeEnvironment = await new DockerComposeEnvironment(dockerPath, 'docker-compose-remote-dynamic.yml')
          .withWaitStrategy(`proof-server_${uid}`, Wait.forLogMessage('Actix runtime found; starting in Actix runtime'))
          .withEnvironment({ TESTCONTAINERS_UID: uid, NETWORK_ID: 'qanet' })
          .up();
        break;
      }
      case 'testnet': {
        composeEnvironment = await new DockerComposeEnvironment(dockerPath, 'docker-compose-remote-dynamic.yml')
          .withWaitStrategy(`proof-server_${uid}`, Wait.forLogMessage('Actix runtime found; starting in Actix runtime'))
          .withEnvironment({ TESTCONTAINERS_UID: uid, NETWORK_ID: 'testnet' })
          .up();
        break;
      }
      case 'preview': {
        composeEnvironment = await new DockerComposeEnvironment(dockerPath, 'docker-compose-remote-dynamic.yml')
          .withWaitStrategy(`proof-server_${uid}`, Wait.forLogMessage('Actix runtime found; starting in Actix runtime'))
          .withEnvironment({ TESTCONTAINERS_UID: uid, NETWORK_ID: 'preview' })
          .up();
        break;
      }
      case 'preprod': {
        composeEnvironment = await new DockerComposeEnvironment(dockerPath, 'docker-compose-remote-dynamic.yml')
          .withWaitStrategy(`proof-server_${uid}`, Wait.forLogMessage('Actix runtime found; starting in Actix runtime'))
          .withEnvironment({ TESTCONTAINERS_UID: uid, NETWORK_ID: 'preprod' })
          .up();
        break;
      }
      default: {
        logger.warn(`Unrecognized network: ${process.env['NETWORK']}`);
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

export function useHardForkFixture() {
  let fixture: TestContainersFixture | undefined;

  beforeAll(async () => {
    logger.info(`Spinning up ${process.env['NETWORK']} hard fork test environment...`);
    const composeEnvironment = await new DockerComposeEnvironment(dockerPath, 'docker-compose-hfs.yml')
      .withWaitStrategy(`proof-server`, Wait.forLogMessage('Actix runtime found; starting in Actix runtime'))
      .withWaitStrategy(`proof-server-dummy`, Wait.forLogMessage('Actix runtime found; starting in Actix runtime'))
      .withWaitStrategy(`node`, Wait.forListeningPorts())
      .withWaitStrategy(`indexer`, Wait.forLogMessage("Block with hash: '[a-fA-F0-9]+' and height '0'  was indexed"))
      .up();

    logger.info('Test environment started');
    fixture = new TestContainersFixture(composeEnvironment);
  }, 120_000);

  afterAll(async () => {
    logger.info('Tearing down hard fork test environment...');
    await fixture?.down();
    logger.info('HF test environment torn down');
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
