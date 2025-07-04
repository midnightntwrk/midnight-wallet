import * as ProverClient from '../ProverClient';
import * as HttpProverClient from '../HttpProverClient';
import { SerializedUnprovenTransaction } from '../SerializedUnprovenTransaction';
import { Effect } from 'effect';
import {
  UnprovenTransaction,
  UnprovenOffer,
  NetworkId,
  UnprovenOutput,
  nativeToken,
  createCoinInfo,
  sampleCoinPublicKey,
  sampleEncryptionPublicKey,
  Transaction,
  LedgerParameters,
} from '@midnight-ntwrk/zswap';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const PROOF_SERVER_IMAGE: string = 'ghcr.io/midnight-ntwrk/proof-server:4.0.0';
const PROOF_SERVER_PORT: number = 6300;

const timeout_minutes = (mins: number) => 1_000 * 60 * mins;

describe('HttpProverClient', () => {
  describe('layer', () => {
    // Ensures that we cannot construct a layer for HttpProverClient when we use common incorrect URI schemes.
    it.each(['ftp:', 'mailto:', 'ws:', 'wss:', 'file:'])(
      'should fail when constructed with %s as the URI scheme',
      async (scheme) => {
        await Effect.gen(function* () {
          // We should never be able to resolve a ProverClient since the configuration used to create the
          // associated HttpProverClient layer is invalid with the protocol schemes being used.
          return yield* ProverClient.ProverClient;
        }).pipe(
          Effect.flatMap((_) => Effect.fail('Unexpectedly resolved a ProverClient')),
          Effect.provide(HttpProverClient.layer({ url: `${scheme}//localhost.com` })),
          // Ensure the reported invalid protocol scheme is the one used.
          Effect.catchTag('InvalidProtocolSchemeError', (err) =>
            err.invalidScheme !== scheme
              ? Effect.fail(`Expected '${scheme}' but received '${err.invalidScheme}'`)
              : Effect.succeed(void 0),
          ),
          Effect.runPromise,
        );
      },
    );
  });

  describe('with available Proof Server', () => {
    let proofServerContainer: StartedTestContainer | undefined = undefined;

    const proofServerPort = () => proofServerContainer?.getMappedPort(PROOF_SERVER_PORT) ?? PROOF_SERVER_PORT;

    const dustToken = nativeToken();
    const makeValidTransaction = (spendCoinAmount: bigint) => {
      const spendCoin = createCoinInfo(dustToken, spendCoinAmount);
      const cpk = sampleCoinPublicKey();
      const epk = sampleEncryptionPublicKey();
      const output = UnprovenOutput.new(spendCoin, 0, cpk, epk);
      const unprovenOffer = UnprovenOffer.fromOutput(output, dustToken, spendCoinAmount);

      return new UnprovenTransaction(unprovenOffer);
    };

    beforeAll(async () => {
      proofServerContainer = await new GenericContainer(PROOF_SERVER_IMAGE)
        .withExposedPorts(PROOF_SERVER_PORT)
        .withWaitStrategy(Wait.forListeningPorts())
        .start();
    }, timeout_minutes(3));

    afterAll(async () => {
      await proofServerContainer?.stop();
    }, timeout_minutes(1));

    it(
      'should prove a valid transaction',
      async () => {
        await Effect.gen(function* () {
          const proveClient = yield* ProverClient.ProverClient;
          const spendCoinAmount = 1_000n;

          const unprovenTransactionBytes = makeValidTransaction(spendCoinAmount).serialize(NetworkId.Undeployed);

          const txBytes = yield* proveClient.proveTransaction(SerializedUnprovenTransaction(unprovenTransactionBytes));
          const tx = Transaction.deserialize(txBytes, NetworkId.Undeployed);
          const imbalances = tx.imbalances(true);

          expect(imbalances.size).toEqual(1);
          expect(imbalances.get(dustToken)).toEqual(-spendCoinAmount);
          expect(tx.fees(LedgerParameters.dummyParameters())).not.toEqual(0n);
        }).pipe(
          Effect.provide(HttpProverClient.layer({ url: `http://localhost:${proofServerPort()}` })),
          Effect.catchAll((err) => Effect.fail(`Encountered unexpected '${err._tag}' error: ${err.message}`)),
          Effect.runPromise,
        );
      },
      timeout_minutes(1),
    );

    it(
      'should fail to prove an invalid transaction',
      async () => {
        await Effect.gen(function* () {
          const proveClient = yield* ProverClient.ProverClient;

          const unprovenTransactionBytes = makeValidTransaction(1n).serialize(NetworkId.TestNet);

          yield* proveClient.proveTransaction(SerializedUnprovenTransaction(unprovenTransactionBytes));
        }).pipe(
          Effect.catchTag('ProverServerError', () => Effect.succeed(void 0)),
          Effect.catchTag('ProverClientError', () => Effect.succeed(void 0)),
          Effect.provide(HttpProverClient.layer({ url: `http://localhost:${proofServerPort()}` })),
          Effect.catchAll((err) => Effect.fail(`Encountered unexpected '${err._tag}' error: ${err.message}`)),
          Effect.runPromise,
        );
      },
      timeout_minutes(1),
    );
  });
});
