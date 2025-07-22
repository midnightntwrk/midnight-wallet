import { HttpProverClient } from '@midnight-ntwrk/wallet-prover-client-ts/effect';
import * as zswap from '@midnight-ntwrk/zswap';
import { Effect, Either, Layer, pipe } from 'effect';
import { GenericContainer, Wait } from 'testcontainers';
import { httpProveTx, makeDefaultProvingService, makeProofErasingProvingService } from '../Proving';
import { BALANCE_TRANSACTION_TO_PROVE, NOTHING_TO_PROVE, ProvingRecipe, TRANSACTION_TO_PROVE } from '../ProvingRecipe';
import { WalletError } from '../WalletError';

const PROOF_SERVER_IMAGE: string = 'ghcr.io/midnight-ntwrk/proof-server:4.0.0';
const PROOF_SERVER_PORT: number = 6300;

const minutes = (mins: number) => 1_000 * 60 * mins;

vi.setConfig({ testTimeout: minutes(1) });

const makeTransaction = () => {
  const seed = Buffer.alloc(32, 0);
  const recipient = zswap.SecretKeys.fromSeed(seed);
  const amount = 42n;
  const coin = zswap.createCoinInfo(zswap.nativeToken(), amount);
  const output = zswap.UnprovenOutput.new(coin, 0, recipient.coinPublicKey, recipient.encryptionPublicKey);
  const offer = zswap.UnprovenOffer.fromOutput(output, zswap.nativeToken(), amount);
  return new zswap.UnprovenTransaction(offer);
};

const proofServerContainerResource = Effect.acquireRelease(
  Effect.promise(() => {
    return new GenericContainer(PROOF_SERVER_IMAGE)
      .withExposedPorts(PROOF_SERVER_PORT)
      .withWaitStrategy(Wait.forListeningPorts())
      .withReuse()
      .start();
  }),
  (container) => Effect.promise(() => container.stop()),
).pipe(
  Effect.map((proofServerContainer) => {
    const proofServerPort = proofServerContainer.getMappedPort(PROOF_SERVER_PORT);
    return new URL(`http://localhost:${proofServerPort}`);
  }),
);

describe('Default Proving Service', () => {
  const adHocProve = (tx: zswap.UnprovenTransaction): Effect.Effect<zswap.Transaction> => {
    return pipe(
      httpProveTx(zswap.NetworkId.Undeployed, tx),
      Effect.provide(
        proofServerContainerResource.pipe(
          Effect.map((url) =>
            HttpProverClient.layer({
              url,
            }),
          ),
          Layer.unwrapEffect,
        ),
      ),
      Effect.scoped,
      Effect.orDie,
    );
  };

  const testProvenTxEffect = pipe(makeTransaction(), adHocProve, Effect.cached, Effect.flatten);
  const testUnprovenTx = makeTransaction();

  const recipes: ReadonlyArray<{ recipe: Effect.Effect<ProvingRecipe<zswap.Transaction>>; expectedImbalance: bigint }> =
    [
      {
        recipe: pipe(
          testProvenTxEffect,
          Effect.map((testProvenTx) => ({ type: NOTHING_TO_PROVE, transaction: testProvenTx })),
        ),
        expectedImbalance: -42n,
      },
      {
        recipe: pipe(
          testProvenTxEffect,
          Effect.map((testProvenTx) => ({
            type: BALANCE_TRANSACTION_TO_PROVE,
            transactionToBalance: testProvenTx,
            transactionToProve: testUnprovenTx,
          })),
        ),
        expectedImbalance: -84n,
      },
      { recipe: Effect.succeed({ type: TRANSACTION_TO_PROVE, transaction: testUnprovenTx }), expectedImbalance: -42n },
    ] as const;
  it.each(recipes)(
    'does transform proving recipe into final, proven transaction',
    async ({ recipe, expectedImbalance }) => {
      const finalTx = await Effect.gen(function* () {
        const readyRecipe = yield* recipe;
        const proofServerUrl = yield* proofServerContainerResource;
        const service = makeDefaultProvingService({
          provingServerUrl: proofServerUrl,
          networkId: zswap.NetworkId.Undeployed,
        });

        return yield* service.prove(readyRecipe);
      }).pipe(Effect.scoped, Effect.runPromise);

      expect(finalTx).toBeInstanceOf(zswap.Transaction);
      expect(finalTx.imbalances(true).get(zswap.nativeToken())).toEqual(expectedImbalance);
    },
  );

  it('does fail with wallet error instance when proving fails (e.g. due to misconfiguration)', async () => {
    const recipe = { type: TRANSACTION_TO_PROVE, transaction: testUnprovenTx } as const;
    const result = await Effect.gen(function* () {
      const proofServerUrl = yield* proofServerContainerResource;
      const misconfiguredService = makeDefaultProvingService({
        provingServerUrl: proofServerUrl,
        networkId: zswap.NetworkId.MainNet,
      });
      return yield* misconfiguredService.prove(recipe);
    }).pipe(Effect.scoped, Effect.either, Effect.runPromise);

    Either.match(result, {
      onRight: (result) => {
        throw new Error(`Unexpected success: ${result.toString()}`);
      },
      onLeft: (error) => {
        expect(error).toBeInstanceOf(WalletError);
      },
    });
  });

  it('does fail with wallet error instance when proving fails (e.g. due to connection error)', async () => {
    const recipe = { type: TRANSACTION_TO_PROVE, transaction: testUnprovenTx } as const;
    const result = await Effect.gen(function* () {
      const proofServerUrl = yield* proofServerContainerResource.pipe(Effect.scoped); //This makes the container stop immediately
      const misconfiguredService = makeDefaultProvingService({
        provingServerUrl: proofServerUrl,
        networkId: zswap.NetworkId.Undeployed,
      });
      return yield* misconfiguredService.prove(recipe);
    }).pipe(Effect.either, Effect.runPromise);

    Either.match(result, {
      onRight: (result) => {
        throw new Error(`Unexpected success: ${result.toString()}`);
      },
      onLeft: (error) => {
        expect(error).toBeInstanceOf(WalletError);
      },
    });
  });
});

describe('Erasing proving service', () => {
  const testUnprovenTx = makeTransaction();
  const testErasedTx = makeTransaction().eraseProofs();

  const recipes = [
    { recipe: { type: NOTHING_TO_PROVE, transaction: testErasedTx }, expectedImbalance: -42n },
    {
      recipe: {
        type: BALANCE_TRANSACTION_TO_PROVE,
        transactionToBalance: testErasedTx,
        transactionToProve: testUnprovenTx,
      },
      expectedImbalance: -84n,
    },
    { recipe: { type: TRANSACTION_TO_PROVE, transaction: testUnprovenTx }, expectedImbalance: -42n },
  ] as const;

  it.each(recipes)(
    'does transform proving recipe into final, proof-erased transaction',
    async ({ recipe, expectedImbalance }) => {
      const service = makeProofErasingProvingService();
      const finalTx: zswap.ProofErasedTransaction = await service.prove(recipe).pipe(Effect.runPromise);

      expect(finalTx).toBeInstanceOf(zswap.ProofErasedTransaction);
      expect(finalTx.imbalances(true).get(zswap.nativeToken())).toEqual(expectedImbalance);
    },
  );
});
