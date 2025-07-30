import { Effect, identity, Scope } from 'effect';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { getPortPromise } from 'portfinder';

const startContainer = (container: GenericContainer): Effect.Effect<StartedTestContainer, Error, Scope.Scope> => {
  return Effect.acquireRelease(
    Effect.promise(() => container.start()),
    (container) => Effect.promise(() => container.stop({ timeout: 5_000 })),
  );
};

export const runNodeContainer = (
  adjustment: (t: GenericContainer) => GenericContainer = identity,
): Effect.Effect<StartedTestContainer, Error, Scope.Scope> => {
  const container = new GenericContainer('ghcr.io/midnight-ntwrk/midnight-node:0.12.0')
    .withEnvironment({
      CFG_PRESET: 'dev',
      SIDECHAIN_BLOCK_BENEFICIARY: '04bcf7ad3be7a5c790460be82a713af570f22e0f801f6659ab8e84a52be6969e',
    })
    .withExposedPorts(9944);
  return startContainer(adjustment(container));
};

export const runProofServerContainer = (
  adjustment: (t: GenericContainer) => GenericContainer = identity,
): Effect.Effect<StartedTestContainer, Error, Scope.Scope> => {
  const container = new GenericContainer('ghcr.io/midnight-ntwrk/proof-server:4.0.0')
    .withEnvironment({
      RUST_BACKTRACE: 'full',
    })
    .withExposedPorts(6300)
    .withCommand(['midnight-proof-server -v --network undeployed']);
  return startContainer(adjustment(container));
};

export const findAvailablePort: Effect.Effect<number> = Effect.promise(() => getPortPromise());
