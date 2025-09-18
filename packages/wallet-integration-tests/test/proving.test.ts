import { HttpProverClient } from '@midnight-ntwrk/wallet-sdk-prover-client/effect';
import { Proving, ProvingRecipe, WalletError } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import * as ledger from '@midnight-ntwrk/ledger';
import { Effect, Either, Layer, pipe } from 'effect';
import * as os from 'node:os';
import { GenericContainer, Wait } from 'testcontainers';
import { describe, expect, it, vi } from 'vitest';
import { getNonDustImbalance } from './utils';

const PROOF_SERVER_IMAGE: string = 'ghcr.io/midnight-ntwrk/proof-server:5.0.0-alpha.2';
const PROOF_SERVER_PORT: number = 6300;

vi.setConfig({ testTimeout: 120_000, hookTimeout: 30_000 });

const shieldedTokenType = (ledger.shieldedToken() as { tag: 'shielded'; raw: string }).raw;

const makeTransaction = () => {
  const seed = Buffer.alloc(32, 0);
  const recipient = ledger.ZswapSecretKeys.fromSeed(seed);
  const amount = 42n;
  const coin = ledger.createShieldedCoinInfo(shieldedTokenType, amount);
  const output = ledger.ZswapOutput.new(coin, 0, recipient.coinPublicKey, recipient.encryptionPublicKey);
  const offer = ledger.ZswapOffer.fromOutput(output, shieldedTokenType, amount);
  return ledger.Transaction.fromParts(offer);
};

const proofServerContainerResource = Effect.acquireRelease(
  Effect.promise(() => {
    return new GenericContainer(PROOF_SERVER_IMAGE)
      .withExposedPorts(PROOF_SERVER_PORT)
      .withWaitStrategy(Wait.forListeningPorts())
      .withEnvironment({
        RAYON_NUM_THREADS: Math.min(os.availableParallelism(), 32).toString(10),
      })
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
  const adHocProve = (
    tx: ledger.Transaction<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding>,
  ): Effect.Effect<ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>> => {
    return pipe(
      Proving.httpProveTx(ledger.NetworkId.Undeployed, tx),
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

  const recipes: ReadonlyArray<{
    recipe: Effect.Effect<
      ProvingRecipe.ProvingRecipe<ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>>
    >;
    expectedImbalance: bigint;
  }> = [
    {
      recipe: pipe(
        testProvenTxEffect,
        Effect.map((testProvenTx) => ({ type: ProvingRecipe.NOTHING_TO_PROVE, transaction: testProvenTx })),
      ),
      expectedImbalance: -42n,
    },
    {
      recipe: pipe(
        testProvenTxEffect,
        Effect.map((testProvenTx) => ({
          type: ProvingRecipe.BALANCE_TRANSACTION_TO_PROVE,
          transactionToBalance: testProvenTx,
          transactionToProve: testUnprovenTx,
        })),
      ),
      expectedImbalance: -84n,
    },
    {
      recipe: Effect.succeed({ type: ProvingRecipe.TRANSACTION_TO_PROVE, transaction: testUnprovenTx }),
      expectedImbalance: -42n,
    },
  ] as const;
  it.each(recipes)(
    'does transform proving recipe into final, proven transaction',
    async ({ recipe, expectedImbalance }) => {
      const finalTx = await Effect.gen(function* () {
        const readyRecipe = yield* recipe;
        const proofServerUrl = yield* proofServerContainerResource;
        const service = Proving.makeDefaultProvingService({
          provingServerUrl: proofServerUrl,
          networkId: ledger.NetworkId.Undeployed,
        });

        return yield* service.prove(readyRecipe);
      }).pipe(Effect.scoped, Effect.runPromise);

      expect(finalTx).toBeInstanceOf(ledger.Transaction);
      expect(getNonDustImbalance(finalTx.imbalances(0), shieldedTokenType)).toEqual(expectedImbalance);
    },
  );

  it('does fail with wallet error instance when proving fails (e.g. due to misconfiguration)', async () => {
    const recipe = { type: ProvingRecipe.TRANSACTION_TO_PROVE, transaction: testUnprovenTx } as const;
    const result = await Effect.gen(function* () {
      const proofServerUrl = yield* proofServerContainerResource;
      const misconfiguredService = Proving.makeDefaultProvingService({
        provingServerUrl: proofServerUrl,
        networkId: ledger.NetworkId.MainNet,
      });
      return yield* misconfiguredService.prove(recipe);
    }).pipe(Effect.scoped, Effect.either, Effect.runPromise);

    Either.match(result, {
      onRight: (result) => {
        throw new Error(`Unexpected success: ${result.toString()}`);
      },
      onLeft: (error) => {
        expect(error).toBeInstanceOf(WalletError.ProvingError);
      },
    });
  });

  it('does fail with wallet error instance when proving fails (e.g. due to connection error)', async () => {
    const recipe = { type: ProvingRecipe.TRANSACTION_TO_PROVE, transaction: testUnprovenTx } as const;
    const result = await Effect.gen(function* () {
      const proofServerUrl = yield* proofServerContainerResource.pipe(Effect.scoped); //This makes the container stop immediately
      const misconfiguredService = Proving.makeDefaultProvingService({
        provingServerUrl: proofServerUrl,
        networkId: ledger.NetworkId.Undeployed,
      });
      return yield* misconfiguredService.prove(recipe);
    }).pipe(Effect.either, Effect.runPromise);

    Either.match(result, {
      onRight: (result) => {
        throw new Error(`Unexpected success: ${result.toString()}`);
      },
      onLeft: (error) => {
        expect(error).toBeInstanceOf(WalletError.ProvingError);
      },
    });
  });
});
