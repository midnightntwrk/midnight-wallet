import { Array as Arr, Either } from 'effect';
import {
  DustActions,
  DustPublicKey,
  DustRegistration,
  DustSecretKey,
  Intent,
  PreBinding,
  PreProof,
  Signature,
  SignatureEnabled,
  SignatureVerifyingKey,
  Transaction,
  UnshieldedOffer,
  Utxo,
  UtxoOutput,
  UtxoSpend,
  FinalizedTransaction,
  ProofErasedTransaction,
  UnprovenTransaction,
} from '@midnight-ntwrk/ledger-v6';
import { MidnightBech32m, DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { ProvingRecipe, WalletError } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { DustCoreWallet } from './DustCoreWallet';
import { ledgerTry } from './common';
import { DustToken } from './types/Dust';
import { TotalCostParameters } from './types/transaction';
import { CoinsAndBalancesCapability, CoinSelection, CoinWithValue } from './CoinsAndBalances';
import { KeysCapability } from './Keys';
import { BindingMarker, ProofMarker, SignatureMarker } from './Utils';
import { AnyTransaction, NetworkId, UnprovenDustSpend } from './types/ledger';

export interface TransactingCapability<TSecrets, TState, TTransaction> {
  readonly networkId: NetworkId;
  readonly costParams: TotalCostParameters;
  createDustGenerationTransaction(
    nextBlock: Date,
    ttl: Date,
    nightUtxos: ReadonlyArray<CoinWithValue<Utxo>>,
    nightVerifyingKey: SignatureVerifyingKey,
    dustReceiverAddress: string | undefined,
  ): Either.Either<UnprovenTransaction, WalletError.WalletError>;

  addDustGenerationSignature(
    transaction: UnprovenTransaction,
    signature: Signature,
  ): Either.Either<ProvingRecipe.ProvingRecipe<UnprovenTransaction>, WalletError.WalletError>;

  addFeePayment(
    secretKey: TSecrets,
    state: TState,
    transaction: UnprovenTransaction,
    nextBlock: Date,
    ttl: Date,
    fee: bigint,
  ): Either.Either<
    { recipe: ProvingRecipe.ProvingRecipe<UnprovenTransaction>; newState: TState },
    WalletError.WalletError
  >;

  revert(state: TState, tx: TTransaction): Either.Either<TState, WalletError.WalletError>;

  revertRecipe(
    state: TState,
    recipe: ProvingRecipe.ProvingRecipe<TTransaction>,
  ): Either.Either<TState, WalletError.WalletError>;
}

export type DefaultTransactingConfiguration = {
  networkId: NetworkId;
  costParameters: TotalCostParameters;
};

export type DefaultTransactingContext = {
  coinSelection: CoinSelection<DustToken>;
  coinsAndBalancesCapability: CoinsAndBalancesCapability<DustCoreWallet>;
  keysCapability: KeysCapability<DustCoreWallet>;
};

export const makeDefaultTransactingCapability = (
  config: DefaultTransactingConfiguration,
  getContext: () => DefaultTransactingContext,
): TransactingCapability<DustSecretKey, DustCoreWallet, FinalizedTransaction> => {
  return new TransactingCapabilityImplementation(
    config.networkId,
    config.costParameters,
    () => getContext().coinSelection,
    () => getContext().coinsAndBalancesCapability,
    () => getContext().keysCapability,
  );
};

export const makeSimulatorTransactingCapability = (
  config: DefaultTransactingConfiguration,
  getContext: () => DefaultTransactingContext,
): TransactingCapability<DustSecretKey, DustCoreWallet, ProofErasedTransaction> => {
  return new TransactingCapabilityImplementation(
    config.networkId,
    config.costParameters,
    () => getContext().coinSelection,
    () => getContext().coinsAndBalancesCapability,
    () => getContext().keysCapability,
  );
};

export class TransactingCapabilityImplementation<TTransaction extends AnyTransaction>
  implements TransactingCapability<DustSecretKey, DustCoreWallet, TTransaction>
{
  public readonly networkId: string;
  public readonly costParams: TotalCostParameters;
  public readonly getCoinSelection: () => CoinSelection<DustToken>;
  readonly getCoins: () => CoinsAndBalancesCapability<DustCoreWallet>;
  readonly getKeys: () => KeysCapability<DustCoreWallet>;

  constructor(
    networkId: NetworkId,
    costParams: TotalCostParameters,
    getCoinSelection: () => CoinSelection<DustToken>,
    getCoins: () => CoinsAndBalancesCapability<DustCoreWallet>,
    getKeys: () => KeysCapability<DustCoreWallet>,
  ) {
    this.getCoins = getCoins;
    this.networkId = networkId;
    this.costParams = costParams;
    this.getCoinSelection = getCoinSelection;
    this.getKeys = getKeys;
  }

  createDustGenerationTransaction(
    nextBlock: Date,
    ttl: Date,
    nightUtxos: Arr.NonEmptyReadonlyArray<CoinWithValue<Utxo>>,
    nightVerifyingKey: SignatureVerifyingKey,
    dustReceiverAddress: string | undefined,
  ): Either.Either<UnprovenTransaction, WalletError.WalletError> {
    return Either.gen(this, function* () {
      const receiver = dustReceiverAddress ? yield* this.#parseAddress(dustReceiverAddress) : undefined;

      return yield* ledgerTry(() => {
        const network = this.networkId;
        const intent = Intent.new(ttl);
        const nightOwner = nightUtxos.at(0)!.token.owner;
        const totalDustValue = nightUtxos.reduce((total, { value }) => total + value, 0n);
        const inputs: UtxoSpend[] = nightUtxos.map(({ token: utxo }) => ({
          ...utxo,
          owner: nightVerifyingKey,
        }));

        const outputs: UtxoOutput[] = inputs.map((input) => ({
          owner: nightOwner,
          type: input.type,
          value: input.value,
        }));

        intent.guaranteedUnshieldedOffer = UnshieldedOffer.new(inputs, outputs, []);

        const dustRegistration: DustRegistration<SignatureEnabled> = new DustRegistration(
          SignatureMarker.signature,
          nightVerifyingKey,
          receiver,
          totalDustValue,
        );

        intent.dustActions = new DustActions<SignatureEnabled, PreProof>(
          SignatureMarker.signature,
          ProofMarker.preProof,
          nextBlock,
          [],
          [dustRegistration],
        );

        return Transaction.fromParts(network, undefined, undefined, intent);
      });
    });
  }

  addDustGenerationSignature(
    transaction: UnprovenTransaction,
    signatureData: Signature,
  ): Either.Either<ProvingRecipe.ProvingRecipe<UnprovenTransaction>, WalletError.WalletError> {
    return Either.gen(this, function* () {
      const intent = transaction.intents?.get(1);
      if (!intent) {
        return yield* Either.left(
          new WalletError.TransactingError({ error: 'No intent found in intent with segment = 1' }),
        );
      }

      const { dustActions } = intent;
      if (!dustActions) {
        return yield* Either.left(new WalletError.TransactingError({ error: 'No dustActions found in intent' }));
      }

      const [registration, ...restRegistrations] = dustActions.registrations;
      if (!registration) {
        return yield* Either.left(new WalletError.TransactingError({ error: 'No registrations found in dustActions' }));
      }

      return yield* ledgerTry(() => {
        const signature = new SignatureEnabled(signatureData);
        const registrationWithSignature = new DustRegistration(
          signature.instance,
          registration.nightKey,
          registration.dustAddress,
          registration.allowFeePayment,
          signature,
        );
        const newDustActions = new DustActions(
          signature.instance,
          ProofMarker.preProof,
          dustActions.ctime,
          dustActions.spends,
          [registrationWithSignature, ...restRegistrations],
        );
        // make a copy of intent to avoid mutation
        const newIntent = Intent.deserialize<SignatureEnabled, PreProof, PreBinding>(
          signature.instance,
          ProofMarker.preProof,
          BindingMarker.preBinding,
          intent.serialize(),
        );
        newIntent.dustActions = newDustActions;

        const newTransaction = Transaction.deserialize<SignatureEnabled, PreProof, PreBinding>(
          signature.instance,
          ProofMarker.preProof,
          BindingMarker.preBinding,
          transaction.serialize(),
        );
        newTransaction.intents = newTransaction.intents!.set(1, newIntent);

        return {
          type: ProvingRecipe.TRANSACTION_TO_PROVE as typeof ProvingRecipe.TRANSACTION_TO_PROVE,
          transaction: newTransaction,
        };
      });
    });
  }

  addFeePayment(
    secretKey: DustSecretKey,
    state: DustCoreWallet,
    transaction: UnprovenTransaction,
    nextBlock: Date,
    ttl: Date,
    fee: bigint,
  ): Either.Either<
    { recipe: ProvingRecipe.ProvingRecipe<UnprovenTransaction>; newState: DustCoreWallet },
    WalletError.WalletError
  > {
    const network = this.networkId;
    const dustTokens = this.getCoins().getAvailableCoinsWithGeneratedDust(state, nextBlock);
    const selectedTokens = this.getCoinSelection()(dustTokens, fee);
    if (!selectedTokens.length) {
      return Either.left(new WalletError.TransactingError({ error: 'No dust tokens found in dustActions' }));
    }

    const totalFeeInSelected = selectedTokens.reduce((total, { value }) => total + value, 0n);
    const feeDiff = totalFeeInSelected - fee;
    if (feeDiff < 0n) {
      // A sanity-check, should never happen
      return Either.left(new WalletError.TransactingError({ error: 'Error in tokens selection algorithm' }));
    }

    // reduce the largest token's value by `feeDiff`
    const tokensWithFeeToTake = [...selectedTokens].sort((a, b) => Number(b.value - a.value));
    if (feeDiff > 0n) {
      const highestByValue = tokensWithFeeToTake[0];
      tokensWithFeeToTake[0] = {
        value: highestByValue.value - feeDiff,
        token: highestByValue.token,
      };
    }
    return ledgerTry(() => {
      const intent = Intent.new(ttl);
      const [spends, updatedState] = state.spendCoins(secretKey, tokensWithFeeToTake, nextBlock);

      intent.dustActions = new DustActions<SignatureEnabled, PreProof>(
        SignatureMarker.signature,
        ProofMarker.preProof,
        nextBlock,
        spends as UnprovenDustSpend[],
        [],
      );

      const feeTransaction = Transaction.fromPartsRandomized(network, undefined, undefined, intent);
      return {
        newState: updatedState,
        recipe: {
          type: ProvingRecipe.TRANSACTION_TO_PROVE,
          transaction: transaction.merge(feeTransaction),
        },
      };
    });
  }

  revert(state: DustCoreWallet, tx: TTransaction): Either.Either<DustCoreWallet, WalletError.WalletError> {
    return Either.try({
      try: () => state.revertTransaction(tx),
      catch: (err) => {
        return new WalletError.OtherWalletError({
          message: `Error while reverting transaction ${tx.identifiers().at(0)!}`,
          cause: err,
        });
      },
    });
  }

  revertRecipe(
    state: DustCoreWallet,
    recipe: ProvingRecipe.ProvingRecipe<TTransaction>,
  ): Either.Either<DustCoreWallet, WalletError.WalletError> {
    const doRevert = (tx: UnprovenTransaction) => {
      return Either.try({
        try: () => state.revertTransaction(tx),
        catch: (err) => {
          return new WalletError.OtherWalletError({
            message: `Error while reverting transaction ${tx.identifiers().at(0)!}`,
            cause: err,
          });
        },
      });
    };

    switch (recipe.type) {
      case ProvingRecipe.TRANSACTION_TO_PROVE:
        return doRevert(recipe.transaction);
      case ProvingRecipe.BALANCE_TRANSACTION_TO_PROVE:
        return doRevert(recipe.transactionToProve);
      case ProvingRecipe.NOTHING_TO_PROVE:
        return Either.right(state);
    }
  }

  #parseAddress(addr: string): Either.Either<DustPublicKey, WalletError.AddressError> {
    return Either.try({
      try: () => {
        const repr = MidnightBech32m.parse(addr);
        return DustAddress.codec.decode(this.networkId, repr).data;
      },
      catch: (err) => {
        return new WalletError.AddressError({
          message: `Address parsing error: ${addr}`,
          originalAddress: addr,
          cause: err,
        });
      },
    });
  }
}
