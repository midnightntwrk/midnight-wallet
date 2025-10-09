import { vi } from 'vitest';
import { beforeEach } from '@vitest/runner';
import { Effect, Scope, SubscriptionRef, Stream } from 'effect';
import {
  DustParameters,
  DustSecretKey,
  Intent,
  LedgerParameters,
  Transaction,
  UnshieldedOffer,
  UserAddress,
  ProofErasedTransaction,
  nativeToken,
} from '@midnight-ntwrk/ledger-v6';
import { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { DateOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { Proving, ProvingRecipe } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { createUnshieldedKeystore, UnshieldedKeystore } from './UnshieldedKeyStore';
import { getDustSeed } from './utils';
import { V1Builder, Transacting, DustCoreWallet, V1Variant, RunningV1Variant } from '../src';
import { Simulator, SimulatorState } from '../src/Simulator';
import { makeSimulatorSyncCapability, makeSimulatorSyncService, SimulatorSyncUpdate } from '../src/Sync';
import * as Submission from '../src/Submission';
import { UtxoWithMeta } from '../src/types/Dust';

vi.setConfig({ testTimeout: 1 * 1000 });

const NIGHT_TOKEN_TYPE = nativeToken().raw;
const SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const SEED_BOB = '0000000000000000000000000000000000000000000000000000000000000002';
const NETWORK = 'undeployed';

const getNightTokens = (state: SimulatorState, walletAddress: UserAddress) => {
  const utxos = state.ledger.utxo.filter(walletAddress);
  return [...utxos].filter((utxo) => utxo.type === NIGHT_TOKEN_TYPE);
};

const getNightTokensWithMeta = (state: SimulatorState, walletAddress: UserAddress): Array<UtxoWithMeta> => {
  const utxos = state.ledger.utxo.filter(walletAddress);
  const result: Array<UtxoWithMeta> = [];
  for (const utxo of utxos) {
    if (utxo.type === NIGHT_TOKEN_TYPE) {
      const meta = state.ledger.utxo.lookupMeta(utxo);
      if (meta) {
        result.push({ utxo, meta });
      }
    }
  }
  return result;
};

const toTxTime = (id: number): Date => new Date(id * 1000);

const waitForTx = (stateRef: SubscriptionRef.SubscriptionRef<DustCoreWallet>, txId: number) => {
  const stream = stateRef.changes.pipe(Stream.find((val) => val.progress.appliedIndex === BigInt(txId)));
  return Stream.runLast(stream);
};

type WalletVariant = V1Variant<string, SimulatorSyncUpdate, ProofErasedTransaction, DustSecretKey>;
type RunningWallet = RunningV1Variant<string, SimulatorSyncUpdate, ProofErasedTransaction, DustSecretKey>;

describe('DustWallet', () => {
  const dustParameters = new DustParameters(5_000_000_000n, 8_267n, 3n * 60n * 60n);
  const costParameters = {
    ledgerParams: LedgerParameters.initialParameters(),
    additionalFeeOverhead: 300_000_000_000_000n,
  };
  let walletVariant: WalletVariant;
  let wallet: RunningWallet;
  let stateRef: SubscriptionRef.SubscriptionRef<DustCoreWallet>;
  let simulator: Simulator;
  let keyStore: UnshieldedKeystore;

  const registerNightTokens = (wallet: RunningWallet, nightTokens: Array<UtxoWithMeta>, nightVerifyingKey: string) => {
    return Effect.gen(function* () {
      const lastState = yield* SubscriptionRef.get(stateRef);
      const simulatorState = yield* simulator.getLatestState();
      const nextBlock = toTxTime(Number(simulatorState.lastTxNumber + 1n));

      const registerForDustTransaction = yield* wallet.createDustGenerationTransaction(
        nextBlock,
        nextBlock,
        nightTokens,
        nightVerifyingKey,
        DustAddress.encodePublicKey(NETWORK, lastState.publicKey.publicKey),
      );

      const intent = registerForDustTransaction.intents!.get(1);
      const intentSignatureData = intent!.signatureData(1);
      const signature = keyStore.signData(intentSignatureData);
      const recipe = (yield* wallet.addDustGenerationSignature(
        registerForDustTransaction,
        signature,
      )) as ProvingRecipe.TransactionToProve;
      expect(recipe.type).toEqual(ProvingRecipe.TRANSACTION_TO_PROVE);

      const signedTransaction = {
        type: ProvingRecipe.NOTHING_TO_PROVE as typeof ProvingRecipe.NOTHING_TO_PROVE,
        transaction: recipe.transaction.eraseProofs(),
      };
      const transaction = yield* wallet.finalizeTransaction(signedTransaction);
      const result = yield* wallet.submitTransaction(transaction);
      const latestSimulatorState = yield* simulator.getLatestState();
      expect(result.blockHeight).toBe(latestSimulatorState.lastTxNumber);
      expect(latestSimulatorState.lastTxResult?.type).toBe('success');
      return result;
    });
  };

  beforeEach(async () =>
    Effect.gen(function* () {
      const dustSeed = getDustSeed(SEED);
      keyStore = createUnshieldedKeystore(dustSeed);
      const dustSecretKey = DustSecretKey.fromSeed(keyStore.getSecretKey());
      const scope = yield* Scope.make();

      simulator = yield* Simulator.init(NETWORK).pipe(Effect.provideService(Scope.Scope, scope));

      walletVariant = new V1Builder()
        .withTransactionType<ProofErasedTransaction>()
        .withProving(Proving.makeSimulatorProvingService)
        .withCoinSelectionDefaults()
        .withTransacting(Transacting.makeSimulatorTransactingCapability)
        .withSync(makeSimulatorSyncService, makeSimulatorSyncCapability)
        .withCoinsAndBalancesDefaults()
        .withKeysDefaults()
        .withSubmission(Submission.makeSimulatorSubmissionService())
        .withSerializationDefaults()
        .build({
          simulator,
          networkId: NETWORK,
          costParameters,
        });

      const initialState = DustCoreWallet.initEmpty(dustParameters, dustSecretKey, NETWORK);
      stateRef = yield* SubscriptionRef.make(initialState);
      wallet = yield* walletVariant.start({ stateRef }).pipe(Effect.provideService(Scope.Scope, scope));
      yield* wallet.startSyncInBackground(dustSecretKey);
    }).pipe(Effect.scoped, Effect.runPromise),
  );

  it('should build', async () => {
    return Effect.gen(function* () {
      const lastState = yield* SubscriptionRef.get(stateRef);
      expect(lastState.isConnected).toBe(true);
    }).pipe(Effect.runPromise);
  });

  it('should get the night tokens', async () => {
    return Effect.gen(function* () {
      const nightVerifyingKey = keyStore.getPublicKey();
      const walletAddress = keyStore.getAddress();
      const awardTokens = 150_000n;

      const rewardNight = yield* simulator.rewardNight(walletAddress, awardTokens, nightVerifyingKey);
      const simulatorState = yield* simulator.getLatestState();
      expect(rewardNight.blockNumber).toBe(1n);
      expect(simulatorState.lastTxNumber).toBe(1n);
      expect(simulatorState.lastTxResult!.type, 'success');

      const nightTokens = getNightTokens(yield* simulator.getLatestState(), walletAddress);
      yield* waitForTx(stateRef, 1);

      expect(nightTokens.length).toBe(1);
      expect(nightTokens[0].value).toBe(awardTokens);
    }).pipe(Effect.runPromise);
  });

  it('should register the night tokens', async () => {
    return Effect.gen(function* () {
      const nightVerifyingKey = keyStore.getPublicKey();
      const walletAddress = keyStore.getAddress();
      const awardTokens = 150_000_000_000n;

      // reward & claim Night tokens
      const rewardNight = yield* simulator.rewardNight(walletAddress, awardTokens, nightVerifyingKey);
      expect(rewardNight.blockNumber).toBe(1n);
      yield* waitForTx(stateRef, 1);

      let latestState = yield* SubscriptionRef.get(stateRef);
      const walletBalance = walletVariant.coinsAndBalances.getWalletBalance(latestState, toTxTime(1));
      expect(walletBalance).toEqual(0n);

      const simulatorState = yield* simulator.getLatestState();
      const nightTokens = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokens.length).toBe(1);

      // register Night tokens
      yield* registerNightTokens(wallet, nightTokens, nightVerifyingKey);
      yield* waitForTx(stateRef, 2);

      latestState = yield* SubscriptionRef.get(stateRef);
      const newWalletBalance = walletVariant.coinsAndBalances.getWalletBalance(latestState, toTxTime(3));
      expect(newWalletBalance).toBe(1_240_050_000_000_000n);
    }).pipe(Effect.runPromise);
  });

  it('should get the right Dust balances', async () => {
    return Effect.gen(function* () {
      const nightVerifyingKey = keyStore.getPublicKey();
      const walletAddress = keyStore.getAddress();
      const awardTokens = 150_000_000_000n;

      // reward & claim Night tokens
      const rewardNight = yield* simulator.rewardNight(walletAddress, awardTokens, nightVerifyingKey);
      expect(rewardNight.blockNumber).toBe(1n);
      yield* waitForTx(stateRef, 1);

      const simulatorState = yield* simulator.getLatestState();
      const nightTokens = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokens.length).toBe(1);

      // register Night tokens
      yield* registerNightTokens(wallet, nightTokens, nightVerifyingKey);
      yield* waitForTx(stateRef, 2);

      const latestState = yield* SubscriptionRef.get(stateRef);

      const availableCoins = walletVariant.coinsAndBalances.getAvailableCoins(latestState);
      expect(availableCoins.length).toBe(1);
      expect(DateOps.dateToSeconds(availableCoins.at(0)!.ctime)).toBe(2n);

      const pendingCoins = walletVariant.coinsAndBalances.getPendingCoins(latestState);
      expect(pendingCoins.length).toBe(0);

      const generationInfo = walletVariant.coinsAndBalances.getGenerationInfo(latestState, availableCoins.at(0)!);
      expect(generationInfo?.value).toBe(awardTokens);
    }).pipe(Effect.runPromise);
  });

  it('should allow to spend Dust tokens', async () => {
    return Effect.gen(function* () {
      const nightVerifyingKey = keyStore.getPublicKey();
      const dustSecretKey = DustSecretKey.fromSeed(keyStore.getSecretKey());
      const walletAddress = keyStore.getAddress();
      const awardTokens = 150_000_000_000n;

      // reward & claim Night tokens
      const rewardNight = yield* simulator.rewardNight(walletAddress, awardTokens, nightVerifyingKey);
      expect(rewardNight.blockNumber).toBe(1n);
      yield* waitForTx(stateRef, 1);

      let simulatorState = yield* simulator.getLatestState();
      const nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(1);

      // register Night tokens
      yield* registerNightTokens(wallet, nightTokensWithMeta, nightVerifyingKey);
      yield* waitForTx(stateRef, 2);

      // get more night tokens with a different amount
      const newNightTokenAmount = 160_000_000_000n;
      const rewardNight2 = yield* simulator.rewardNight(walletAddress, newNightTokenAmount, nightVerifyingKey);
      expect(rewardNight2.blockNumber).toBe(3n);
      simulatorState = yield* simulator.getLatestState();
      expect(simulatorState.lastTxResult!.type, 'success');
      yield* waitForTx(stateRef, 3);

      const walletState = yield* SubscriptionRef.get(stateRef);
      const availableCoins = walletVariant.coinsAndBalances.getAvailableCoins(walletState);
      expect(availableCoins.length).toBe(2);

      // send one token to Bob
      const nightTokens = getNightTokens(simulatorState, walletAddress);
      const sendToken = nightTokens.find((val) => val.value === awardTokens);
      expect(sendToken).toBeDefined();

      const bobKeyStore = createUnshieldedKeystore(getDustSeed(SEED_BOB));
      const bobAddress = bobKeyStore.getAddress();

      const inputs = [
        {
          ...sendToken!,
          owner: nightVerifyingKey,
        },
      ];
      const outputs = [
        {
          type: NIGHT_TOKEN_TYPE,
          owner: bobAddress,
          value: sendToken!.value,
        },
      ];
      const ttl = toTxTime(4);
      const intent = Intent.new(ttl);
      intent.guaranteedUnshieldedOffer = UnshieldedOffer.new(inputs, outputs, []);
      const transferTransaction = Transaction.fromParts(NETWORK, undefined, undefined, intent);

      // cover fees with dust
      const transactionWithFee = (yield* wallet.addFeePayment(
        dustSecretKey,
        transferTransaction,
        toTxTime(4),
        ttl,
      )) as ProvingRecipe.TransactionToProve;

      const transaction = yield* wallet.finalizeTransaction({
        type: ProvingRecipe.NOTHING_TO_PROVE as typeof ProvingRecipe.NOTHING_TO_PROVE,
        transaction: transactionWithFee.transaction.eraseProofs(),
      });

      yield* wallet.submitTransaction(transaction);
      yield* waitForTx(stateRef, 4);

      const latestSimulatorState = yield* simulator.getLatestState();
      expect(latestSimulatorState.lastTxResult?.type).toBe('success');

      const latestState = yield* SubscriptionRef.get(stateRef);
      const newAvailableCoins = walletVariant.coinsAndBalances.getAvailableCoins(latestState);
      const generationInfo = walletVariant.coinsAndBalances.getGenerationInfo(
        latestState,
        availableCoins.find((c) => c.mtIndex === 0n)!,
      );
      expect(newAvailableCoins.length).toBe(2);
      expect(newAvailableCoins.some((coin) => DateOps.dateToSeconds(coin.ctime) === 4n)).toBe(true);
      expect(generationInfo?.dtime).toStrictEqual(DateOps.secondsToDate(4n));

      const pendingCoins = walletVariant.coinsAndBalances.getPendingCoins(latestState);
      expect(pendingCoins.length).toBe(0);
    }).pipe(Effect.runPromise);
  });
});
