import { Effect, identity, Scope } from 'effect';
import { GenericContainer, Network, StartedNetwork, Wait, type StartedTestContainer } from 'testcontainers';
import { getPortPromise } from 'portfinder';

export const createNetwork = (): Effect.Effect<StartedNetwork, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.promise(() => new Network().start()),
    (net) => Effect.promise(() => net.stop()),
  );

const startContainer = (container: GenericContainer): Effect.Effect<StartedTestContainer, Error, Scope.Scope> => {
  return Effect.acquireRelease(
    Effect.promise(() => container.start()),
    (container) => Effect.promise(() => container.stop({ timeout: 5_000 })),
  );
};

export const runNodeContainer = (
  adjustment: (t: GenericContainer) => GenericContainer = identity,
): Effect.Effect<StartedTestContainer, Error, Scope.Scope> => {
  const container = new GenericContainer('ghcr.io/midnight-ntwrk/midnight-node:0.13.0-alpha.2')
    .withEnvironment({
      CFG_PRESET: 'dev',
      SIDECHAIN_BLOCK_BENEFICIARY: '04bcf7ad3be7a5c790460be82a713af570f22e0f801f6659ab8e84a52be6969e',
    })
    .withExposedPorts(9944)
    .withWaitStrategy(Wait.forListeningPorts());
  return startContainer(adjustment(container));
};

export const runProofServerContainer = (
  adjustment: (t: GenericContainer) => GenericContainer = identity,
): Effect.Effect<StartedTestContainer, Error, Scope.Scope> => {
  const container = new GenericContainer('ghcr.io/midnight-ntwrk/proof-server:5.0.0-alpha.2')
    .withEnvironment({
      RUST_BACKTRACE: 'full',
    })
    .withExposedPorts(6300)
    .withCommand(['midnight-proof-server -v --network undeployed'])
    .withWaitStrategy(Wait.forListeningPorts());

  return startContainer(adjustment(container));
};

export const runTxGenerator = (
  config: {
    nodeUrl: string;
    destPath: string;
    fileName: string;
    txsPerBatch: number;
    batches: number;
  },
  adjustment: (t: GenericContainer) => GenericContainer = identity,
): Effect.Effect<StartedTestContainer, Error, Scope.Scope> => {
  const container: GenericContainer = new GenericContainer('ghcr.io/midnight-ntwrk/midnight-generator:0.13.0-alpha.3')
    .withBindMounts([{ source: config.destPath, target: '/tmp', mode: 'rw' }])
    .withCommand([
      'generate-txs',
      '--src-url',
      config.nodeUrl,
      '--dest-file',
      `/tmp/${config.fileName}`,
      'batches',
      '--num-batches',
      String(config.batches),
      '--num-txs-per-batch',
      String(config.txsPerBatch),
    ])
    .withWaitStrategy(Wait.forLogMessage('✓ generated transactions'));

  return startContainer(adjustment(container));
};

export const findAvailablePort: Effect.Effect<number> = Effect.promise(() => getPortPromise());
