import * as ledger from '@midnight-ntwrk/ledger';
import { Array as Arr, Data, Either, Option, pipe, Record } from 'effect';
import { ArrayOps, EitherOps } from '../effect/index';
import { BALANCE_TRANSACTION_TO_PROVE, NOTHING_TO_PROVE, ProvingRecipe, TRANSACTION_TO_PROVE } from './ProvingRecipe';
import { V1State } from './RunningV1Variant';
import { AddressError, InsufficientFundsError, OtherWalletError, WalletError } from './WalletError';
import {
  BalanceRecipe,
  CoinSelection,
  getBalanceRecipe,
  Imbalances,
  InsufficientFundsError as BalancingInsufficientFundsError,
  TransactionCostModel,
} from '@midnight-ntwrk/wallet-sdk-capabilities';
import { MidnightBech32m, ShieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { TotalCostParameters, TransactionImbalances } from './TransactionImbalances';
import { TransactionTrait } from './Transaction';
import { CoinsAndBalancesCapability } from './CoinsAndBalances';
import { KeysCapability } from './Keys';
import { FinalizedTransaction, ProofErasedTransaction, UnprovenTransaction } from './types/ledger';

export interface TokenTransfer {
  readonly amount: bigint;
  readonly type: ledger.RawTokenType;
  readonly receiverAddress: string;
}

export interface TransactingCapability<TState, TTransaction> {
  balanceTransaction(
    state: TState,
    tx: TTransaction,
    newCoins: readonly ledger.ShieldedCoinInfo[],
  ): Either.Either<{ recipe: ProvingRecipe<TTransaction>; newState: TState }, WalletError>;

  makeTransfer(
    state: TState,
    outputs: ReadonlyArray<TokenTransfer>,
  ): Either.Either<{ recipe: ProvingRecipe<TTransaction>; newState: TState }, WalletError>;

  initSwap(
    state: TState,
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: ReadonlyArray<TokenTransfer>,
  ): Either.Either<{ recipe: ProvingRecipe<TTransaction>; newState: TState }, WalletError>;

  //These functions below do not exactly match here, but also seem to be somewhat good place to put
  //The reason is that they primarily make sense in a wallet flavour only able to issue transactions
  revert(state: TState, tx: TTransaction): Either.Either<TState, WalletError>;

  revertRecipe(state: TState, recipe: ProvingRecipe<TTransaction>): Either.Either<TState, WalletError>;
}

export type DefaultTransactingConfiguration = {
  networkId: ledger.NetworkId;
  costParameters: TotalCostParameters;
};

export type DefaultTransactingContext = {
  coinSelection: CoinSelection<ledger.QualifiedShieldedCoinInfo>;
  coinsAndBalancesCapability: CoinsAndBalancesCapability<V1State>;
  keysCapability: KeysCapability<V1State>;
};

export const makeDefaultTransactingCapability = (
  config: DefaultTransactingConfiguration,
  getContext: () => DefaultTransactingContext,
): TransactingCapability<V1State, FinalizedTransaction> => {
  return new TransactingCapabilityImplementation(
    config.networkId,
    config.costParameters,
    () => getContext().coinSelection,
    () => getContext().coinsAndBalancesCapability,
    () => getContext().keysCapability,
    TransactionTrait.default,
  );
};

export const makeSimulatorTransactingCapability = (
  config: DefaultTransactingConfiguration,
  getContext: () => DefaultTransactingContext,
): TransactingCapability<V1State, ProofErasedTransaction> => {
  return new TransactingCapabilityImplementation(
    config.networkId,
    config.costParameters,
    () => getContext().coinSelection,
    () => getContext().coinsAndBalancesCapability,
    () => getContext().keysCapability,
    TransactionTrait.proofErased,
  );
};

class NoSelfOutputsError extends Data.TaggedError('NoSelfOutputs')<object> {}

export class TransactingCapabilityImplementation<
  TTransaction extends ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
> implements TransactingCapability<V1State, TTransaction>
{
  public readonly networkId: ledger.NetworkId;
  public readonly costParams: TotalCostParameters;
  public readonly getCoinSelection: () => CoinSelection<ledger.QualifiedShieldedCoinInfo>;
  public readonly txTrait: TransactionTrait<TTransaction>;
  readonly getCoins: () => CoinsAndBalancesCapability<V1State>;
  readonly getKeys: () => KeysCapability<V1State>;

  constructor(
    networkId: ledger.NetworkId,
    costParams: TotalCostParameters,
    getCoinSelection: () => CoinSelection<ledger.QualifiedShieldedCoinInfo>,
    getCoins: () => CoinsAndBalancesCapability<V1State>,
    getKeys: () => KeysCapability<V1State>,
    txTrait: TransactionTrait<TTransaction>,
  ) {
    this.getCoins = getCoins;
    this.networkId = networkId;
    this.costParams = costParams;
    this.getCoinSelection = getCoinSelection;
    this.getKeys = getKeys;
    this.txTrait = txTrait;
  }

  balanceTransaction(
    state: V1State,
    tx: TTransaction,
    newCoins: ledger.ShieldedCoinInfo[],
  ): Either.Either<{ recipe: ProvingRecipe<TTransaction>; newState: V1State }, WalletError> {
    return Either.gen(this, function* () {
      const coinSelection = this.getCoinSelection();
      const initialImbalances = this.txTrait.getImbalancesWithFeesOverhead(tx, this.costParams);

      if (TransactionImbalances.areBalanced(this.costParams)(initialImbalances) && newCoins.length === 0) {
        return {
          recipe: {
            type: NOTHING_TO_PROVE,
            transaction: tx,
          },
          newState: state,
        };
      }

      const {
        newState: afterFallible,
        offer: maybeFallible,
        newImbalances,
      } = yield* this.balanceFallibleSection(state, initialImbalances, coinSelection);
      const { newState: afterGuaranteed, offer: guaranteed } = yield* this.#balanceGuaranteedSection(
        afterFallible,
        newImbalances,
        coinSelection,
        newCoins.length,
        Imbalances.empty(),
      );
      const finalState = V1State.watchCoins(afterGuaranteed, newCoins);

      return {
        newState: finalState,
        recipe: {
          type: BALANCE_TRANSACTION_TO_PROVE,
          transactionToBalance: tx,
          transactionToProve: ledger.Transaction.fromParts(guaranteed, maybeFallible),
        },
      };
    });
  }

  makeTransfer(
    state: V1State,
    transfers: Arr.NonEmptyReadonlyArray<TokenTransfer>,
  ): Either.Either<{ recipe: ProvingRecipe<TTransaction>; newState: V1State }, WalletError> {
    return Either.gen(this, function* () {
      const { initialOffersAndCoins, selfCoins } = yield* this.#processDesiredOutputs(state, transfers);
      const offerToBalance = pipe(
        initialOffersAndCoins,
        Arr.map((o) => o.outputOffer),
        ArrayOps.fold((a, b) => a.merge(b)),
      );
      const unprovenTxToBalance = ledger.Transaction.fromParts(offerToBalance);
      const imbalances = TransactionTrait.unproven.getImbalancesWithFeesOverhead(unprovenTxToBalance, this.costParams);
      const { offer, newState } = yield* this.#balanceGuaranteedSection(
        state,
        imbalances,
        this.getCoinSelection(),
        selfCoins.length,
        Imbalances.empty(),
      );
      const finalState = V1State.watchCoins(newState, selfCoins);
      const finalTx = unprovenTxToBalance.merge(ledger.Transaction.fromParts(offer));

      return {
        newState: finalState,
        recipe: {
          type: TRANSACTION_TO_PROVE,
          transaction: finalTx,
        },
      };
    });
  }

  initSwap(
    state: V1State,
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: ReadonlyArray<TokenTransfer>,
  ): Either.Either<{ recipe: ProvingRecipe<TTransaction>; newState: V1State }, WalletError> {
    return Either.gen(this, function* () {
      const outputsParseResult = yield* this.#processDesiredOutputsPossiblyEmpty(state, desiredOutputs);
      const inputsParseResult = Imbalances.fromEntries(Record.toEntries(desiredInputs));

      const { offer, newState } = yield* this.#balanceGuaranteedSection(
        state,
        TransactionImbalances.feesOnly(outputsParseResult.imbalances),
        this.getCoinSelection(),
        outputsParseResult.selfCoins.length,
        inputsParseResult,
      );
      const finalState = V1State.watchCoins(newState, outputsParseResult.selfCoins);
      const balancingTx = ledger.Transaction.fromParts(offer);
      const finalTx = outputsParseResult.unprovenTxToBalance
        ? outputsParseResult.unprovenTxToBalance.merge(balancingTx)
        : balancingTx;

      return {
        newState: finalState,
        recipe: {
          type: TRANSACTION_TO_PROVE,
          transaction: finalTx,
        },
      };
    });
  }

  revert(state: V1State, tx: TTransaction): Either.Either<V1State, WalletError> {
    return Either.try({
      try: () => {
        return state.revertTransaction(tx);
      },
      catch: (err) => {
        return new OtherWalletError({
          message: `Error while reverting transaction ${this.txTrait.id(tx)}`,
          cause: err,
        });
      },
    });
  }

  revertRecipe(state: V1State, recipe: ProvingRecipe<TTransaction>): Either.Either<V1State, WalletError> {
    const doRevert = (tx: UnprovenTransaction) => {
      return Either.try({
        try: () => {
          return state.revertTransaction(tx);
        },
        catch: (err) => {
          return new OtherWalletError({
            message: `Error while reverting transaction ${TransactionTrait.unproven.id(tx)}`,
            cause: err,
          });
        },
      });
    };

    switch (recipe.type) {
      case TRANSACTION_TO_PROVE:
        return doRevert(recipe.transaction);
      case BALANCE_TRANSACTION_TO_PROVE:
        return doRevert(recipe.transactionToProve);
      case NOTHING_TO_PROVE:
        return Either.right(state);
    }
  }

  #prepareOffer(
    state: V1State,
    recipe: BalanceRecipe<ledger.QualifiedShieldedCoinInfo, ledger.ShieldedCoinInfo>,
    segment: 0 | 1,
  ): Option.Option<{ newState: V1State; offer: ledger.ZswapOffer<ledger.PreProof> }> {
    const [inputOffers, stateAfterSpends] = V1State.spendCoins(state, recipe.inputs, segment);
    const stateAfterWatches = V1State.watchCoins(stateAfterSpends, recipe.outputs);
    const outputOffers = recipe.outputs.map((coin) => {
      const output = ledger.ZswapOutput.new(
        coin,
        segment,
        this.getKeys().getCoinPublicKey(state).toHexString(),
        this.getKeys().getEncryptionPublicKey(state).toHexString(),
      );
      return ledger.ZswapOffer.fromOutput(output, coin.type, coin.value);
    });

    return pipe(
      Arr.appendAll(inputOffers, outputOffers),
      Arr.match({
        onEmpty: () => Option.none<ledger.ZswapOffer<ledger.PreProof>>(),
        onNonEmpty: (nonEmpty) =>
          pipe(
            nonEmpty,
            ArrayOps.fold((a, b) => a.merge(b)),
            Option.some,
          ),
      }),
      Option.map((offer) => ({ offer, newState: stateAfterWatches })),
    );
  }

  balanceFallibleSection(
    state: V1State,
    imbalances: TransactionImbalances,
    coinSelection: CoinSelection<ledger.QualifiedShieldedCoinInfo>,
  ): Either.Either<
    { offer: ledger.ZswapOffer<ledger.PreProof> | undefined; newState: V1State; newImbalances: TransactionImbalances },
    WalletError
  > {
    return Either.try({
      try: () => {
        // Fallible section does not pay fees, so we balance all tokens to zero
        const fakeCostModel = { inputFeeOverhead: 0n, outputFeeOverhead: 0n };
        const fallibleBalanceRecipe = getBalanceRecipe<ledger.QualifiedShieldedCoinInfo, ledger.ShieldedCoinInfo>({
          coins: this.getCoins()
            .getAvailableCoins(state)
            .map((c) => c.coin),
          initialImbalances: imbalances.fallible,
          transactionCostModel: fakeCostModel,
          feeTokenType: (ledger.shieldedToken() as { raw: string }).raw,
          coinSelection,
          createOutput: (coin) => ledger.createShieldedCoinInfo(coin.type, coin.value),
          isCoinEqual: (a, b) => a.type === b.type && a.value === b.value,
        });
        const fallibleCounterOfferFeeOverhead = TransactionTrait.shared.estimateFeeOverhead({
          numberOfInputs: fallibleBalanceRecipe.inputs.length,
          numberOfOutputs: fallibleBalanceRecipe.outputs.length,
          costParams: this.costParams,
        });
        const updatedImbalances = TransactionImbalances.addFeesOverhead(fallibleCounterOfferFeeOverhead)(imbalances);
        return pipe(
          this.#prepareOffer(state, fallibleBalanceRecipe, 1),
          Option.match({
            onNone: () => ({
              newState: state,
              offer: undefined,
              newImbalances: updatedImbalances,
            }),
            onSome: (res) => ({
              ...res,
              newImbalances: updatedImbalances,
            }),
          }),
        );
      },
      catch: (err) => {
        if (err instanceof BalancingInsufficientFundsError) {
          return new InsufficientFundsError({
            message: 'Insufficient funds',
            tokenType: err.tokenType,
            amount: imbalances.fallible.get(err.tokenType) ?? 0n,
          });
        } else {
          return new OtherWalletError({
            message: 'Balancing fallible section failed',
            cause: err,
          });
        }
      },
    });
  }

  #balanceGuaranteedSection(
    state: V1State,
    imbalances: TransactionImbalances,
    coinSelection: CoinSelection<ledger.QualifiedShieldedCoinInfo>,
    knownSelfOutputs: number,
    targetImbalances: Imbalances,
  ): Either.Either<{ offer: ledger.ZswapOffer<ledger.PreProof>; newState: V1State }, WalletError> {
    const correctedCostModel = TotalCostParameters.getCorrectedCostModel(this.costParams);
    return Either.gen(this, function* () {
      const balanceRecipe = yield* Either.try({
        try: () =>
          getBalanceRecipe<ledger.QualifiedShieldedCoinInfo, ledger.ShieldedCoinInfo>({
            coins: this.getCoins()
              .getAvailableCoins(state)
              .map((c) => c.coin),
            initialImbalances: imbalances.guaranteed,
            transactionCostModel: correctedCostModel,
            feeTokenType: (ledger.shieldedToken() as { raw: string }).raw,
            coinSelection,
            createOutput: (coin) => ledger.createShieldedCoinInfo(coin.type, coin.value),
            isCoinEqual: (a, b) => a.nonce === b.nonce,
            targetImbalances,
          }),
        catch: (err) => {
          if (err instanceof BalancingInsufficientFundsError) {
            return new InsufficientFundsError({
              message: 'Insufficient funds',
              tokenType: err.tokenType,
              amount: imbalances.guaranteed.get(err.tokenType) ?? 0n,
            });
          } else {
            return new OtherWalletError({
              message: 'Balancing guaranteed section failed',
              cause: err,
            });
          }
        },
      });

      if (balanceRecipe.outputs.length + knownSelfOutputs == 0) {
        return yield* Either.left(new NoSelfOutputsError({}));
      }

      return yield* pipe(
        this.#prepareOffer(state, balanceRecipe, 0),
        Either.fromOption(() => {
          return new OtherWalletError({
            message: 'Could not create a valid guaranteed offer',
          });
        }),
      );
    }).pipe(
      EitherOps.flatMapLeft((err: NoSelfOutputsError | WalletError) => {
        if (err instanceof NoSelfOutputsError) {
          return this.#balanceGuaranteedWithSelfOutput(
            state,
            imbalances,
            coinSelection,
            correctedCostModel,
            targetImbalances,
          );
        } else {
          return Either.left(err);
        }
      }),
    );
  }

  #balanceGuaranteedWithSelfOutput(
    state: V1State,
    imbalances: TransactionImbalances,
    coinSelection: CoinSelection<ledger.QualifiedShieldedCoinInfo>,
    correctedCostModel: TransactionCostModel,
    targetImbalances: Imbalances,
  ) {
    return Either.gen(this, function* () {
      const additionalOutputValue = 100_000n;
      const balanceRecipe = yield* Either.try({
        try: () => {
          return getBalanceRecipe<ledger.QualifiedShieldedCoinInfo, ledger.ShieldedCoinInfo>({
            coins: this.getCoins()
              .getAvailableCoins(state)
              .map((c) => c.coin),
            initialImbalances: Imbalances.merge(
              imbalances.guaranteed,
              Imbalances.fromEntry(
                (ledger.shieldedToken() as { raw: string }).raw,
                -1n * (additionalOutputValue + correctedCostModel.outputFeeOverhead),
              ),
            ),
            transactionCostModel: this.costParams.ledgerParams.transactionCostModel,
            feeTokenType: (ledger.shieldedToken() as { raw: string }).raw,
            coinSelection,
            targetImbalances,
            createOutput: (coin) => ledger.createShieldedCoinInfo(coin.type, coin.value),
            isCoinEqual: (a, b) => a.nonce === b.nonce,
          });
        },
        catch: (err) => {
          if (err instanceof BalancingInsufficientFundsError) {
            return new InsufficientFundsError({
              message: 'Insufficient funds',
              tokenType: err.tokenType,
              amount: imbalances.guaranteed.get(err.tokenType) ?? 0n,
            });
          } else {
            return new OtherWalletError({
              message: 'Balancing guaranteed section failed',
              cause: err,
            });
          }
        },
      });
      const additionalCoin = ledger.createShieldedCoinInfo(
        (ledger.shieldedToken() as { raw: string }).raw,
        additionalOutputValue,
      );
      const additionalOffer = pipe(
        additionalCoin,
        (coin) =>
          ledger.ZswapOutput.new(
            coin,
            0,
            this.getKeys().getCoinPublicKey(state).toHexString(),
            this.getKeys().getEncryptionPublicKey(state).toHexString(),
          ),
        (output) =>
          ledger.ZswapOffer.fromOutput(output, (ledger.shieldedToken() as { raw: string }).raw, additionalOutputValue),
      );

      return yield* pipe(
        this.#prepareOffer(state, balanceRecipe, 0),
        Option.map(({ newState, offer }) => {
          return {
            newState: V1State.watchCoins(newState, [additionalCoin]),
            offer: offer.merge(additionalOffer),
          };
        }),
        Either.fromOption(() => {
          return new OtherWalletError({
            message: 'Balancing guaranteed section failed',
          });
        }),
      );
    });
  }

  #parseAddress(addr: string) {
    return Either.try({
      try: () => {
        const repr = MidnightBech32m.parse(addr);
        return ShieldedAddress.codec.decode(this.networkId, repr);
      },
      catch: (err) => {
        return new AddressError({
          message: `Address parsing error: ${addr}`,
          originalAddress: addr,
          cause: err,
        });
      },
    });
  }

  #processDesiredOutputs(state: V1State, transfers: Arr.NonEmptyReadonlyArray<TokenTransfer>) {
    return Either.gen(this, function* () {
      const initialOffersAndCoins = yield* pipe(
        transfers,
        Arr.map((transfer) => {
          return pipe(
            this.#parseAddress(transfer.receiverAddress),
            Either.map((address) => {
              const coin = ledger.createShieldedCoinInfo(transfer.type, transfer.amount);
              const output = ledger.ZswapOutput.new(
                coin,
                0,
                address.coinPublicKey.toHexString(),
                address.encryptionPublicKey.toHexString(),
              );
              const outputOffer = ledger.ZswapOffer.fromOutput(output, transfer.type, transfer.amount);

              return {
                coin,
                outputOffer,
                isForSelf: address.coinPublicKey.equals(this.getKeys().getCoinPublicKey(state)),
              };
            }),
          );
        }),
        Either.all,
      );
      const selfCoins = Arr.flatMap(
        initialOffersAndCoins,
        ({ coin, isForSelf }): readonly ledger.ShieldedCoinInfo[] => {
          if (isForSelf) {
            return [coin];
          } else {
            return [];
          }
        },
      );

      return { initialOffersAndCoins, selfCoins };
    });
  }

  #processDesiredOutputsPossiblyEmpty(state: V1State, desiredOutputs: ReadonlyArray<TokenTransfer>) {
    return pipe(
      desiredOutputs,
      Arr.match({
        onEmpty: () => {
          return Either.right({
            imbalances: TransactionImbalances.empty(),
            selfCoins: [],
            unprovenTxToBalance: null,
          });
        },
        onNonEmpty: (desiredOutputs) => {
          return pipe(
            this.#processDesiredOutputs(state, desiredOutputs),
            Either.map(({ initialOffersAndCoins, selfCoins }) => {
              const offerToBalance = pipe(
                initialOffersAndCoins,
                Arr.map((o) => o.outputOffer),
                ArrayOps.fold((a, b) => a.merge(b)),
              );
              const unprovenTxToBalance = ledger.Transaction.fromParts(offerToBalance);
              const imbalances = TransactionTrait.unproven.getImbalancesWithFeesOverhead(
                unprovenTxToBalance,
                this.costParams,
              );

              return {
                imbalances,
                selfCoins,
                unprovenTxToBalance,
              };
            }),
          );
        },
      }),
    );
  }
}
