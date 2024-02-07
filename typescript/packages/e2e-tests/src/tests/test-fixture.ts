/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { exit } from 'process';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { StartedGenericContainer } from 'testcontainers/build/generic-container/started-generic-container';
import { MidnightDeployment, MidnightNetwork, createLogger } from './utils';
import path from 'node:path';

export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
const logger = await createLogger(
  path.resolve(currentDir, '..', 'logs', 'test-fixture', `${new Date().toISOString()}.log`),
);

export function useTestContainersFixture() {
  let fixture: TestContainersFixture | undefined;

  beforeEach(async () => {
    logger.info(`Spinning up ${process.env.NETWORK} test environment...`);
    const uid = Math.floor(Math.random() * 1000).toString();
    let composeEnvironment: StartedDockerComposeEnvironment;
    switch (process.env.NETWORK as MidnightNetwork) {
      case 'undeployed': {
        composeEnvironment = await new DockerComposeEnvironment('./', 'docker-compose-dynamic.yml')
          .withWaitStrategy(`proof-server_${uid}`, Wait.forLogMessage('Actix runtime found; starting in Actix runtime'))
          .withWaitStrategy(`node_${uid}`, Wait.forListeningPorts())
          .withWaitStrategy(`indexer_${uid}`, Wait.forLogMessage(/http4s v[\d.]+ on blaze v[\d.]+ started at /))
          .withEnvironment({ TESTCONTAINERS_UID: uid })
          .up();
        break;
      }
      case 'devnet': {
        composeEnvironment = await new DockerComposeEnvironment('./', 'docker-compose-devnet-dynamic.yml')
          .withWaitStrategy(`proof-server_${uid}`, Wait.forLogMessage('Actix runtime found; starting in Actix runtime'))
          .withEnvironment({ TESTCONTAINERS_UID: uid })
          .up();
        break;
      }
      default: {
        logger.warn(`Unrecognized network: ${process.env.NETWORK}`);
        exit(1);
      }
    }
    logger.info('Test environment started');
    fixture = new TestContainersFixture(composeEnvironment, uid);
  }, 120_000);

  afterEach(async () => {
    logger.info('Tearing down test environment...');
    await fixture?.down();
    logger.info('Test environment torn down');
  }, 60_000);

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return () => fixture!;
}

export class TestContainersFixture {
  constructor(public readonly composeEnvironment: StartedDockerComposeEnvironment, private readonly uid: string) {}

  public async down() {
    await this.composeEnvironment.down();
  }

  public static readonly PROOF_SERVER_PORT = 6300;
  public static readonly NODE_PORT_RPC = 9944;
  public static readonly INDEXER_PORT = 8088;
  static readonly network = process.env.NETWORK as MidnightNetwork;
  static readonly deployment = process.env.DEPLOYMENT as MidnightDeployment;

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
      case 'devnet': {
        return 'https://pubsub.devnet-midnight.network:443/api/v0/graphql';
      }
      case 'qanet': {
        return 'https://pubsub-qa.devnet-midnight.network:443/api/v0/graphql';
      }
      case 'local': {
        const indexerPort = this.getIndexerPort();
        return `http://localhost:${indexerPort}/api/v0/graphql`;
      }
    }
  }

  public getIndexerWsUri(): string {
    switch (TestContainersFixture.deployment) {
      case 'devnet': {
        return 'wss://pubsub.devnet-midnight.network:443/api/v0/graphql/ws';
      }
      case 'qanet': {
        return 'wss://pubsub-qa.devnet-midnight.network:443/api/v0/graphql/ws';
      }
      case 'local': {
        const indexerPort = this.getIndexerPort();
        return `ws://localhost:${indexerPort}/api/v0/graphql/ws`;
      }
    }
  }

  public getNodeUri(): string {
    switch (TestContainersFixture.deployment) {
      case 'devnet': {
        return 'https://alb-node-peer-1.devnet-midnight.network:9944';
      }
      case 'qanet': {
        return 'https://alb-node-peer-1-qa.devnet-midnight.network:9944';
      }
      case 'local': {
        const nodePortRpc = this.getNodeContainer().getMappedPort(TestContainersFixture.NODE_PORT_RPC);
        return `http://localhost:${nodePortRpc}`;
      }
    }
  }
}
