import {
  addressFromKey,
  Intent,
  LedgerState,
  sampleRawTokenType,
  sampleSigningKey,
  sampleUserAddress,
  signatureVerifyingKey,
  signData,
  Transaction,
  TransactionContext,
  UnshieldedOffer,
  WellFormedStrictness,
  ZswapChainState,
} from '@midnight-ntwrk/ledger-v6';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { UnshieldedStateService } from '@midnight-ntwrk/wallet-sdk-unshielded-state';
import { Effect, Either, HashSet } from 'effect';
import { describe, expect, it } from 'vitest';
import { TransactionService, TransactionServiceError } from '../src/TransactionService.js';
import { blockTime, generateMockTransaction, seedHex } from './testUtils.js';

const strictness = new WellFormedStrictness();
strictness.enforceBalancing = false;
strictness.verifyContractProofs = false;
strictness.verifyNativeProofs = false;
strictness.enforceBalancing = false;

describe('TransactionService', () => {
  it('should build a transfer transaction from one desired output', () =>
    Effect.gen(function* () {
      const token = sampleRawTokenType();
      const receiverAddress = sampleUserAddress();
      const amount = 1n;
      const desiredOutputs = [
        {
          type: token,
          receiverAddress,
          amount,
        },
      ];
      const transactionService = yield* TransactionService;
      const transferTransaction = yield* transactionService.transferTransaction(
        desiredOutputs,
        new Date(),
        NetworkId.NetworkId.Undeployed,
      );
      expect(transferTransaction.intents?.size).toEqual(1);
      expect(transferTransaction.intents?.get(1)?.guaranteedUnshieldedOffer).toBeDefined();

      const offer = transferTransaction.intents!.get(1)!.guaranteedUnshieldedOffer!;
      expect(offer.inputs.length).toEqual(0);
      expect(offer.outputs.length).toEqual(1);
      expect(offer.signatures.length).toEqual(0);
      expect(offer.outputs.at(0)).toMatchObject({ owner: receiverAddress, value: amount, type: token });
    }).pipe(Effect.provide(TransactionService.Live), Effect.runPromise));

  it('should build a transfer transaction from multiple desired output', () =>
    Effect.gen(function* () {
      const token = sampleRawTokenType();
      const recipient1 = sampleUserAddress();
      const recipient2 = sampleUserAddress();
      const amount1 = 10n;
      const amount2 = 20n;
      const desiredOutputs = [
        {
          type: token,
          receiverAddress: recipient1,
          amount: amount1,
        },
        {
          type: token,
          receiverAddress: recipient2,
          amount: amount2,
        },
      ];
      const transactionService = yield* TransactionService;
      const transferTransaction = yield* transactionService.transferTransaction(
        desiredOutputs,
        new Date(),
        NetworkId.NetworkId.Undeployed,
      );
      expect(transferTransaction.intents?.size).toEqual(1);
      expect(transferTransaction.intents?.get(1)?.guaranteedUnshieldedOffer).toBeDefined();

      const offer = transferTransaction.intents!.get(1)!.guaranteedUnshieldedOffer!;
      expect(offer.inputs.length).toEqual(0);
      expect(offer.outputs.length).toEqual(2);
      expect(offer.signatures.length).toEqual(0);
      expect(offer.outputs.at(0)).toMatchObject({ owner: recipient1, value: amount1, type: token });
      expect(offer.outputs.at(1)).toMatchObject({ owner: recipient2, value: amount2, type: token });
    }).pipe(Effect.provide(TransactionService.Live), Effect.runPromise));

  it('should fail on non-positive amount', async () =>
    Effect.gen(function* () {
      const ttl = new Date();
      const token = sampleRawTokenType();
      const receiverAddress = sampleUserAddress();
      const transactionService = yield* TransactionService;

      const amount1 = 0n;
      const desiredOutputs1 = [
        {
          type: token,
          receiverAddress,
          amount: amount1,
        },
      ];
      const result1 = yield* Effect.either(
        transactionService.transferTransaction(desiredOutputs1, ttl, NetworkId.NetworkId.Undeployed),
      );

      expect(Either.isLeft(result1)).toBe(true);
      if (Either.isLeft(result1)) {
        expect(result1.left).toBeInstanceOf(TransactionServiceError);
        expect(result1.left.error).toEqual('The amount needs to be positive');
      }

      const amount2 = -10n;
      const desiredOutputs2 = [
        {
          type: token,
          receiverAddress,
          amount: amount2,
        },
      ];

      const result2 = yield* Effect.either(
        transactionService.transferTransaction(desiredOutputs2, ttl, NetworkId.NetworkId.Undeployed),
      );

      expect(Either.isLeft(result2)).toBe(true);
      if (Either.isLeft(result2)) {
        expect(result2.left).toBeInstanceOf(TransactionServiceError);
        expect(result2.left.error).toEqual('The amount needs to be positive');
      }
    }).pipe(Effect.provide(TransactionService.Live), Effect.runPromise));

  it('should balance the transfer transaction', () =>
    Effect.gen(function* () {
      const transactionService = yield* TransactionService;
      const unshieldedState = yield* UnshieldedStateService;

      // fill the state
      const token = sampleRawTokenType();
      const owner = signatureVerifyingKey(sampleSigningKey());
      const ownerAddress = addressFromKey(owner);

      const mockTx = generateMockTransaction(owner, token, 'SucceedEntirely', 1, 0);
      yield* unshieldedState.applyTx(mockTx);
      const stateAfterTx = yield* unshieldedState.getLatestState();
      expect(HashSet.size(stateAfterTx.utxos)).toEqual(1);

      // build a transfer tx
      const amount = 1n;
      const desiredOutputs = [
        {
          type: token,
          receiverAddress: sampleUserAddress(),
          amount,
        },
      ];
      const transferTransaction = yield* transactionService.transferTransaction(
        desiredOutputs,
        new Date(),
        NetworkId.NetworkId.Undeployed,
      );
      expect(transferTransaction.intents?.get(1)?.guaranteedUnshieldedOffer).toBeDefined();

      const balancedTx = yield* transactionService.balanceTransaction(
        transferTransaction,
        unshieldedState,
        ownerAddress,
        owner,
      );
      const tokenImbalances = balancedTx
        .imbalances(0)
        .entries()
        .filter(([tokenType, _]) => tokenType.tag === 'unshielded' && tokenType.raw === token)
        .next().value;

      expect(tokenImbalances?.[1]).toEqual(0n);
      expect(balancedTx.imbalances(1).size).toEqual(0);
    }).pipe(Effect.provide(TransactionService.Live), Effect.provide(UnshieldedStateService.Live()), Effect.runPromise));

  it('should balance a transaction with a fallible unshielded offer set', () =>
    Effect.gen(function* () {
      const transactionService = yield* TransactionService;
      const unshieldedState = yield* UnshieldedStateService;

      // fill the state
      const token = sampleRawTokenType();
      const owner = signatureVerifyingKey(sampleSigningKey());
      const ownerAddress = addressFromKey(owner);

      const mockTx = generateMockTransaction(owner, token, 'SucceedEntirely', 1, 0);
      yield* unshieldedState.applyTx(mockTx);
      const stateAfterTx = yield* unshieldedState.getLatestState();
      expect(HashSet.size(stateAfterTx.utxos)).toEqual(1);

      const receiverAddress = sampleUserAddress();
      const amount = 1n;
      const desiredOutputs = [
        {
          type: token,
          receiverAddress,
          amount,
        },
      ];
      const transferTransaction = yield* transactionService.transferTransaction(
        desiredOutputs,
        new Date(),
        NetworkId.NetworkId.Undeployed,
      );
      expect(transferTransaction.intents?.size).toEqual(1);
      expect(transferTransaction.intents?.get(1)?.guaranteedUnshieldedOffer).toBeDefined();

      // move the guaranteed unshielded offer into the fallible section
      const intent = transferTransaction.intents!.get(1)!;
      intent.fallibleUnshieldedOffer = intent.guaranteedUnshieldedOffer;
      intent.guaranteedUnshieldedOffer = undefined;
      transferTransaction.intents = transferTransaction.intents!.set(1, intent);
      expect(transferTransaction.intents.get(1)?.guaranteedUnshieldedOffer).toBeUndefined();
      expect(transferTransaction.intents?.get(1)?.fallibleUnshieldedOffer).toBeDefined();

      const balancedTx = yield* transactionService.balanceTransaction(
        transferTransaction,
        unshieldedState,
        ownerAddress,
        owner,
      );
      const tokenImbalances = balancedTx
        .imbalances(1)
        .entries()
        .filter(([tokenType, _]) => tokenType.tag === 'unshielded' && tokenType.raw === token)
        .next().value;

      expect(tokenImbalances?.[1]).toEqual(0n);
      expect(balancedTx.imbalances(0).size).toEqual(0);
    }).pipe(Effect.provide(TransactionService.Live), Effect.provide(UnshieldedStateService.Live()), Effect.runPromise));

  it('should fail on empty state', async () => {
    const token = sampleRawTokenType();
    const amount = 1n;
    const desiredOutputs = [
      {
        type: token,
        receiverAddress: sampleUserAddress(),
        amount,
      },
    ];
    const owner = signatureVerifyingKey(sampleSigningKey());

    const result = await Effect.gen(function* () {
      const transactionService = yield* TransactionService;
      const unshieldedState = yield* UnshieldedStateService;
      const tx = yield* transactionService.transferTransaction(
        desiredOutputs,
        new Date(),
        NetworkId.NetworkId.Undeployed,
      );
      return yield* transactionService.balanceTransaction(tx, unshieldedState, sampleUserAddress(), owner);
    }).pipe(
      Effect.provide(TransactionService.Live),
      Effect.provide(UnshieldedStateService.Live()),
      Effect.either,
      Effect.runPromise,
    );

    Either.match(result, {
      onRight: (result) => {
        throw new Error(`Unexpected success: ${result.toString()}`);
      },
      onLeft: (error) => {
        expect(error).toBeInstanceOf(TransactionServiceError);
        expect((error as TransactionServiceError).error).toEqual(`Insufficient Funds: could not balance ${token}`);
      },
    });
  });

  it('should fail on a state without a related coin', () =>
    Effect.gen(function* () {
      const transactionService = yield* TransactionService;
      const unshieldedState = yield* UnshieldedStateService;

      // fill the state
      const token1 = sampleRawTokenType();
      const token2 = sampleRawTokenType();
      const owner = signatureVerifyingKey(sampleSigningKey());
      const mockTx = generateMockTransaction(owner, token1, 'SucceedEntirely', 1, 0);
      yield* unshieldedState.applyTx(mockTx);

      // build a transfer tx
      const amount = 1n;
      const desiredOutputs = [
        {
          type: token2,
          receiverAddress: sampleUserAddress(),
          amount,
        },
      ];

      const tx = yield* transactionService.transferTransaction(
        desiredOutputs,
        new Date(),
        NetworkId.NetworkId.Undeployed,
      );
      const result = yield* Effect.either(
        transactionService.balanceTransaction(tx, unshieldedState, sampleUserAddress(), owner),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(TransactionServiceError);
        expect((result.left as TransactionServiceError).error).toEqual(
          `Insufficient Funds: could not balance ${token2}`,
        );
      }
    }).pipe(Effect.provide(TransactionService.Live), Effect.provide(UnshieldedStateService.Live()), Effect.runPromise));

  it('should handle a state with multiple outputs', () =>
    Effect.gen(function* () {
      const transactionService = yield* TransactionService;
      const unshieldedState = yield* UnshieldedStateService;

      // fill the state
      const token = sampleRawTokenType();
      const owner = signatureVerifyingKey(sampleSigningKey());
      const ownerAddress = addressFromKey(owner);
      const mockTx = generateMockTransaction(owner, token, 'SucceedEntirely', 10, 0);
      yield* unshieldedState.applyTx(mockTx);

      // build a transfer tx
      const amount = 3n;
      const desiredOutputs = [
        {
          type: token,
          receiverAddress: sampleUserAddress(),
          amount,
        },
      ];
      const transferTransaction = yield* transactionService.transferTransaction(
        desiredOutputs,
        new Date(),
        NetworkId.NetworkId.Undeployed,
      );
      const balancedTransaction = yield* transactionService.balanceTransaction(
        transferTransaction,
        unshieldedState,
        ownerAddress,
        owner,
      );
      expect(balancedTransaction.intents?.size).toEqual(1);
      expect(balancedTransaction.intents?.get(1)?.guaranteedUnshieldedOffer).toBeDefined();
    }).pipe(Effect.provide(TransactionService.Live), Effect.provide(UnshieldedStateService.Live()), Effect.runPromise));

  it('should mark selected coins as pending', () =>
    Effect.gen(function* () {
      const transactionService = yield* TransactionService;
      const unshieldedState = yield* UnshieldedStateService;

      // fill the state
      const token = sampleRawTokenType();
      const owner = signatureVerifyingKey(sampleSigningKey());
      const ownerAddress = addressFromKey(owner);
      const createdOutputs = 10;
      const mockTx = generateMockTransaction(owner, token, 'SucceedEntirely', createdOutputs, 0);
      yield* unshieldedState.applyTx(mockTx);

      const stateAfterTx = yield* unshieldedState.getLatestState();
      expect(HashSet.size(stateAfterTx.utxos)).toEqual(createdOutputs);
      expect(HashSet.size(stateAfterTx.pendingUtxos)).toEqual(0);

      // build a transfer tx
      const amount = 1n;
      const desiredOutputs = [
        {
          type: token,
          receiverAddress: sampleUserAddress(),
          amount,
        },
      ];
      const transferTransaction = yield* transactionService.transferTransaction(
        desiredOutputs,
        new Date(),
        NetworkId.NetworkId.Undeployed,
      );
      const _ = yield* transactionService.balanceTransaction(transferTransaction, unshieldedState, ownerAddress, owner);

      // validate the state got changed
      const currentState = yield* unshieldedState.getLatestState();
      expect(HashSet.size(currentState.utxos)).toEqual(createdOutputs - 1);
      expect(HashSet.size(currentState.pendingUtxos)).toEqual(1);
    }).pipe(Effect.provide(TransactionService.Live), Effect.provide(UnshieldedStateService.Live()), Effect.runPromise));

  it('should get the right segments', () =>
    Effect.gen(function* () {
      const transactionService = yield* TransactionService;
      const desiredOutputs = [
        {
          type: sampleRawTokenType(),
          receiverAddress: sampleUserAddress(),
          amount: 1n,
        },
      ];
      const transferTransaction = yield* transactionService.transferTransaction(
        desiredOutputs,
        new Date(),
        NetworkId.NetworkId.Undeployed,
      );
      const segments = transactionService.getSegments(transferTransaction);
      expect(segments).toEqual([1]);
    }).pipe(Effect.provide(TransactionService.Live), Effect.runPromise));

  it('should get the signature', () =>
    Effect.gen(function* () {
      const transactionService = yield* TransactionService;
      const amount = 3n;
      const desiredOutputs = [
        {
          type: sampleRawTokenType(),
          receiverAddress: sampleUserAddress(),
          amount,
        },
      ];
      const transferTransaction = yield* transactionService.transferTransaction(
        desiredOutputs,
        new Date(),
        NetworkId.NetworkId.Undeployed,
      );

      // a positive case
      const signature = yield* transactionService.getOfferSignatureData(transferTransaction, 1);
      expect(signature.toString()).toBeTruthy();

      // validate we can't get a signature for non-existing segment
      const fail = yield* Effect.either(transactionService.getOfferSignatureData(transferTransaction, 10));
      expect(Either.isLeft(fail)).toBe(true);
      if (Either.isLeft(fail)) {
        expect(fail.left).toBeInstanceOf(TransactionServiceError);
        expect(fail.left.error).toEqual(`Intent with a given segment was not found`);
      }
    }).pipe(Effect.provide(TransactionService.Live), Effect.runPromise));

  it('should add the signature', () =>
    Effect.gen(function* () {
      const transactionService = yield* TransactionService;

      const signingKey = sampleSigningKey();
      const desiredOutputs = [
        {
          type: sampleRawTokenType(),
          receiverAddress: sampleUserAddress(),
          amount: 3n,
        },
      ];
      const transferTransaction = yield* transactionService.transferTransaction(
        desiredOutputs,
        new Date(),
        NetworkId.NetworkId.Undeployed,
      );
      const signatureData = yield* transactionService.getOfferSignatureData(transferTransaction, 1);
      const signature = signData(signingKey, signatureData);

      const transactionWithSignatures = yield* transactionService.addOfferSignature(transferTransaction, signature, 1);
      expect(transactionWithSignatures.intents?.size).toEqual(1);
      expect(transactionWithSignatures.intents?.get(1)?.guaranteedUnshieldedOffer).toBeDefined();
      expect(transactionWithSignatures.intents?.get(1)?.guaranteedUnshieldedOffer?.inputs?.length).toEqual(
        transactionWithSignatures.intents?.get(1)?.guaranteedUnshieldedOffer?.signatures?.length,
      );

      const fail = yield* Effect.either(transactionService.addOfferSignature(transferTransaction, signature, 10));
      expect(Either.isLeft(fail)).toBe(true);
      if (Either.isLeft(fail)) {
        expect(fail.left).toBeInstanceOf(TransactionServiceError);
        expect(fail.left.error).toEqual(`Intent with a given segment was not found`);
      }
    }).pipe(Effect.provide(TransactionService.Live), Effect.provide(UnshieldedStateService.Live()), Effect.runPromise));

  it('should serialize and deserialize transaction', () =>
    Effect.gen(function* () {
      const token = sampleRawTokenType();
      const receiverAddress = sampleUserAddress();
      const amount = 1n;
      const desiredOutputs = [
        {
          type: token,
          receiverAddress,
          amount,
        },
      ];
      const transactionService = yield* TransactionService;
      const transferTransaction = yield* transactionService.transferTransaction(
        desiredOutputs,
        new Date(),
        NetworkId.NetworkId.Undeployed,
      );
      const serializedTransaction = yield* transactionService.serializeTransaction(transferTransaction);

      const deserializeTransaction = yield* transactionService.deserializeTransaction(
        'signature',
        'pre-proof',
        'pre-binding',
        serializedTransaction,
      );

      expect(deserializeTransaction.intents?.size).toEqual(1);
      expect(deserializeTransaction.intents?.get(1)?.guaranteedUnshieldedOffer).toBeDefined();

      const offer = deserializeTransaction.intents!.get(1)!.guaranteedUnshieldedOffer!;
      expect(offer.inputs.length).toEqual(0);
      expect(offer.outputs.length).toEqual(1);
      expect(offer.signatures.length).toEqual(0);
      expect(offer.outputs.at(0)).toMatchObject({ owner: receiverAddress, value: amount, type: token });
    }).pipe(Effect.provide(TransactionService.Live), Effect.runPromise));

  it('should validate the ledger state gets updated', () =>
    Effect.gen(function* () {
      const transactionService = yield* TransactionService;
      const unshieldedState = yield* UnshieldedStateService;
      const ledgerState = new LedgerState(NetworkId.NetworkId.Undeployed, new ZswapChainState());

      const token = sampleRawTokenType();
      const signingKey = sampleSigningKey();
      const owner = signatureVerifyingKey(signingKey);
      const ownerAddress = addressFromKey(owner);

      // fill the ledger initial state
      const outputs = [
        {
          value: 50n,
          owner: ownerAddress,
          type: token,
        },
      ];
      const intent1Date = new Date(Date.now() + 60 * 24 * 1000); // 1 hour in the future
      const intent1 = Intent.new(intent1Date);
      intent1.guaranteedUnshieldedOffer = UnshieldedOffer.new([], outputs, []);
      const tx1 = Transaction.fromParts(NetworkId.NetworkId.Undeployed, undefined, undefined, intent1);
      const proofErasedTx1 = tx1.eraseProofs();

      const verifiedProofErasedTx1 = proofErasedTx1.wellFormed(ledgerState, strictness, new Date());

      const blockContext = {
        secondsSinceEpoch: blockTime(new Date()),
        secondsSinceEpochErr: 0,
        parentBlockHash: seedHex(64, 2),
      };

      const [ledgerStateAfter1, result1] = ledgerState.apply(
        verifiedProofErasedTx1,
        new TransactionContext(ledgerState, blockContext, new Set()),
      );

      expect(result1.type).toEqual('success');
      expect(ledgerStateAfter1.utxo.utxos.size).toEqual(1);
      expect(ledgerStateAfter1.utxo.filter(ownerAddress).size).toEqual(1);

      // fill the unshielded state
      const createdUtxos = [...ledgerStateAfter1.utxo.filter(ownerAddress)];
      yield* unshieldedState.applyTx({
        id: 123,
        hash: crypto.randomUUID(),
        type: 'RegularTransaction',
        identifiers: proofErasedTx1.identifiers(),
        createdUtxos: createdUtxos.map(({ value, type, intentHash, outputNo }) => ({
          value,
          owner,
          type,
          intentHash,
          outputNo,
          registeredForDustGeneration: true,
        })),
        spentUtxos: [],
        protocolVersion: 1,
        transactionResult: {
          status: 'SucceedEntirely',
          segments: [{ id: '1', success: true }],
        },
      });

      // simulate the spend tx
      const receiverAddress = sampleUserAddress();
      const desiredOutputs = [
        {
          type: token,
          receiverAddress,
          amount: 1n,
        },
      ];
      const withChange = createdUtxos[0].value !== 1n;

      const transferTransaction = yield* transactionService.transferTransaction(
        desiredOutputs,
        new Date(Date.now() + 60 * 24 * 1000), // 1 hour in the future
        NetworkId.NetworkId.Undeployed,
      );
      const balancedTx = yield* transactionService.balanceTransaction(
        transferTransaction,
        unshieldedState,
        ownerAddress,
        owner,
      );
      const signatureData = yield* transactionService.getOfferSignatureData(balancedTx, 1);
      const signature = signData(signingKey, signatureData);
      const transactionWithSignatures = yield* transactionService.addOfferSignature(balancedTx, signature, 1);
      const proofErasedTx = transactionWithSignatures.eraseProofs();
      const verifiedProofErasedTx = proofErasedTx.wellFormed(ledgerStateAfter1, strictness, new Date());

      const [ledgerStateAfter2, result2] = ledgerStateAfter1.apply(
        verifiedProofErasedTx,
        new TransactionContext(ledgerStateAfter1, blockContext, new Set()),
      );

      expect(result2.type).toEqual('success');
      expect(ledgerStateAfter2.utxo.utxos.size).toEqual(withChange ? 2 : 1);
      expect(ledgerStateAfter2.utxo.filter(ownerAddress).size).toEqual(withChange ? 1 : 0);
      expect(ledgerStateAfter2.utxo.filter(receiverAddress).size).toEqual(1);
    }).pipe(Effect.provide(TransactionService.Live), Effect.provide(UnshieldedStateService.Live()), Effect.runPromise));
});
