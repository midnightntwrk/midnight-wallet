/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { exit } from 'process';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { StartedGenericContainer } from 'testcontainers/build/generic-container/started-generic-container';
import { MidnightDeployment, MidnightNetwork } from './utils';
import { logger } from './logger';

export function useTestContainersFixture() {
  let fixture: TestContainersFixture | undefined;

  beforeAll(async () => {
    logger.info(`Spinning up ${process.env['NETWORK']} test environment...`);
    const uid = Math.floor(Math.random() * 1000).toString();
    let composeEnvironment: StartedDockerComposeEnvironment;
    switch (process.env['NETWORK'] as MidnightNetwork) {
      case 'undeployed': {
        composeEnvironment = await new DockerComposeEnvironment('./', 'docker-compose-dynamic.yml')
          .withWaitStrategy(`proof-server_${uid}`, Wait.forLogMessage('Actix runtime found; starting in Actix runtime'))
          .withWaitStrategy(`node_${uid}`, Wait.forListeningPorts())
          .withWaitStrategy(`indexer_${uid}`, Wait.forListeningPorts())
          .withEnvironment({ TESTCONTAINERS_UID: uid })
          .up();
        break;
      }
      case 'devnet': {
        composeEnvironment = await new DockerComposeEnvironment('./', 'docker-compose-remote-dynamic.yml')
          .withWaitStrategy(`proof-server_${uid}`, Wait.forLogMessage('Actix runtime found; starting in Actix runtime'))
          .withEnvironment({ TESTCONTAINERS_UID: uid, NETWORK_ID: 'devnet' })
          .up();
        break;
      }
      case 'testnet': {
        composeEnvironment = await new DockerComposeEnvironment('./', 'docker-compose-remote-dynamic.yml')
          .withWaitStrategy(`proof-server_${uid}`, Wait.forLogMessage('Actix runtime found; starting in Actix runtime'))
          .withEnvironment({ TESTCONTAINERS_UID: uid, NETWORK_ID: 'testnet' })
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
    logger.info(`Spinning up ${process.env.NETWORK} hard fork test environment...`);
    const composeEnvironment = await new DockerComposeEnvironment('./', 'docker-compose-hfs.yml')
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
  constructor(
    public readonly composeEnvironment: StartedDockerComposeEnvironment,
    private readonly uid?: string,
  ) {}

  public async down() {
    await this.composeEnvironment.down();
  }

  public static readonly PROOF_SERVER_PORT = 6300;
  public static readonly NODE_PORT_RPC = 9944;
  public static readonly INDEXER_PORT = 8088;
  static readonly network = process.env['NETWORK'] as MidnightNetwork;
  static readonly deployment = process.env['DEPLOYMENT'] as MidnightDeployment;

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
    switch (TestContainersFixture.deployment) {
      case 'testnet': {
        return 'https://indexer.testnet-02.midnight.network/api/v1/graphql';
      }
      case 'qanet': {
        return 'https://indexer-rs.qanet.dev.midnight.network/api/v1/graphql';
      }
      case 'local': {
        const indexerPort = this.getIndexerPort();
        return `http://localhost:${indexerPort}/api/v1/graphql`;
      }
    }
  }

  public getIndexerWsUri(): string {
    switch (TestContainersFixture.deployment) {
      case 'testnet': {
        return 'wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws';
      }
      case 'qanet': {
        return 'wss://indexer-rs.qanet.dev.midnight.network/api/v1/graphql/ws';
      }
      case 'local': {
        const indexerPort = this.getIndexerPort();
        return `ws://localhost:${indexerPort}/api/v1/graphql/ws`;
      }
    }
  }

  public getNodeUri(): string {
    switch (TestContainersFixture.deployment) {
      case 'testnet': {
        return 'https://rpc.testnet-02.midnight.network';
      }
      case 'qanet': {
        return 'https://rpc.qanet.dev.midnight.network';
      }
      case 'local': {
        const nodePortRpc = this.getNodeContainer().getMappedPort(TestContainersFixture.NODE_PORT_RPC);
        return `http://localhost:${nodePortRpc}`;
      }
    }
  }
}
