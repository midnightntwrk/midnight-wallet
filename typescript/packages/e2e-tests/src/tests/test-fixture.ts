/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { StartedGenericContainer } from 'testcontainers/build/generic-container/started-generic-container';

export function useTestContainersFixture() {
  let fixture: TestContainersFixture | undefined;

  beforeEach(async () => {
    console.log('Spinning up test environment...');
    const uid = Math.floor(Math.random() * 1000).toString();
    const composeEnvironment: StartedDockerComposeEnvironment = await new DockerComposeEnvironment(
      './',
      'docker-compose-dynamic.yml',
    )
      .withWaitStrategy(`proof-server_${uid}`, Wait.forListeningPorts())
      .withWaitStrategy(`node_${uid}`, Wait.forListeningPorts())
      .withWaitStrategy(`indexer_${uid}`, Wait.forListeningPorts())
      .withEnvironment({ TESTCONTAINERS_UID: uid })
      .up();
    console.log('Test environment started');
    fixture = new TestContainersFixture(composeEnvironment, uid);
  }, 120_000);

  afterEach(async () => {
    console.log('Tearing down test environment...');
    await fixture?.down();
    console.log('Test environment torn down');
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
  public static readonly NODE_PORT_RPC = 9933;
  public static readonly INDEXER_PORT = 8088;

  public getProverUri(): string {
    const proofServer: StartedGenericContainer = this.composeEnvironment.getContainer(`proof-server_${this.uid}`);
    const proofServerPort = proofServer.getMappedPort(TestContainersFixture.PROOF_SERVER_PORT);
    return `http://localhost:${proofServerPort}`;
  }

  private getIndexerPort(): number {
    const indexer: StartedGenericContainer = this.composeEnvironment.getContainer(`indexer_${this.uid}`);
    return indexer.getMappedPort(TestContainersFixture.INDEXER_PORT);
  }

  public getIndexerUri(): string {
    const indexerPort = this.getIndexerPort();
    return `http://localhost:${indexerPort}/api/graphql`;
  }

  public getIndexerWsUri(): string {
    const indexerPort = this.getIndexerPort();
    return `ws://localhost:${indexerPort}/api/graphql/ws`;
  }

  public getNodeUri(): string {
    const node: StartedGenericContainer = this.composeEnvironment.getContainer(`node_${this.uid}`);
    const nodePortRpc = node.getMappedPort(TestContainersFixture.NODE_PORT_RPC);
    return `http://localhost:${nodePortRpc}`;
  }
}
